import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { verifyAccessToken } from '../utils/jwt';
import { forbidden, unauthenticated } from '../utils/errors';
import { AuthContext } from '../types';

export const ACCESS_COOKIE = 'wpp_access_token';
export const REFRESH_COOKIE = 'wpp_refresh_token';

function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookie ?? null;
}

/**
 * Verifies the access token, then re-reads the user, session, roles and
 * permissions from PostgreSQL on every request.
 *
 * The token is only proof of *identity*; authority always comes from the
 * database. That means a revoked session, a disabled account or a permission
 * removed a second ago takes effect immediately, rather than lingering until
 * the token expires.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw unauthenticated('Authentication required');

    const payload = verifyAccessToken(token);

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });

    if (!session || session.status !== 'ACTIVE' || session.expiresAt <= new Date()) {
      throw unauthenticated('Session is no longer valid');
    }
    if (session.userId !== payload.sub) throw unauthenticated('Session mismatch');

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, organizationId: payload.organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        email: true,
        fullName: true,
        status: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                deletedAt: true,
                rolePermissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user) throw unauthenticated('Account no longer exists');
    if (user.status !== 'ACTIVE') throw forbidden(`Account is ${user.status.toLowerCase()}`);

    const activeRoles = user.userRoles.filter((ur) => ur.role.deletedAt === null);
    const permissions = new Set<string>();
    for (const { role } of activeRoles) {
      for (const rp of role.rolePermissions) permissions.add(rp.permission.key);
    }

    const auth: AuthContext = {
      userId: user.id,
      organizationId: user.organizationId,
      branchId: user.branchId,
      sessionId: session.id,
      email: user.email,
      fullName: user.fullName,
      roles: activeRoles.map((ur) => ur.role.name),
      permissions,
    };

    req.auth = auth;

    // Best-effort liveness marker; never blocks the request.
    void prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (error) {
    next(error);
  }
}

/** Populates `req.auth` when a valid token is present, but never rejects. */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!extractToken(req)) {
    next();
    return;
  }
  await requireAuth(req, res, (err?: unknown) => next(err instanceof Error ? undefined : err));
}

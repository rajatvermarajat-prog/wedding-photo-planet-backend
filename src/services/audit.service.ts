import { AuditAction, Prisma } from '@prisma/client';
import { Db, prisma } from '../config/prisma';
import { AuthContext } from '../types';
import { logger } from '../config/logger';

/**
 * Keys that must never be persisted to the audit trail (§24). Matching is
 * case-insensitive and applies at every depth of the snapshot.
 */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'refresh_token_hash',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
];

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    // Value objects (notably Prisma `Decimal`) know how to render themselves.
    // Spreading their internals instead would produce `{s, e, d}` noise that
    // jsonb cannot accept, so always prefer toJSON when present.
    const candidate = value as { toJSON?: () => unknown };
    if (typeof candidate.toJSON === 'function') {
      try {
        return candidate.toJSON();
      } catch {
        return String(value);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? '[REDACTED]' : scrub(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  oldData?: unknown;
  newData?: unknown;
}

export interface AuditRequestContext {
  organizationId: string;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export function auditContextFromAuth(
  auth: AuthContext,
  req?: { ip?: string; headers: Record<string, unknown>; requestId?: string },
): AuditRequestContext {
  return {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ipAddress: req?.ip ?? null,
    userAgent: typeof req?.headers?.['user-agent'] === 'string'
      ? (req.headers['user-agent'] as string).slice(0, 512)
      : null,
    requestId: req?.requestId ?? null,
  };
}

/**
 * Writes an audit row. Pass the transaction client so the audit entry commits
 * or rolls back atomically with the change it describes (§34).
 */
export async function recordAudit(
  db: Db,
  context: AuditRequestContext,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      actorId: context.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary?.slice(0, 500) ?? null,
      oldData: (scrub(input.oldData) ?? Prisma.DbNull) as Prisma.InputJsonValue,
      newData: (scrub(input.newData) ?? Prisma.DbNull) as Prisma.InputJsonValue,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    },
  });
}

/** Fire-and-forget variant for paths where a log failure must not fail the request. */
export function recordAuditSafe(context: AuditRequestContext, input: AuditInput): void {
  void recordAudit(prisma, context, input).catch((err) =>
    logger.warn({ err, entityType: input.entityType }, 'audit write failed'),
  );
}

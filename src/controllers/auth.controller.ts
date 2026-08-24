import { Request, Response } from 'express';
import { env } from '../config/env';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../middleware/auth';
import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendSuccess } from '../utils/response';
import { unauthenticated } from '../utils/errors';
import * as authService from '../services/auth.service';

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? ('none' as const) : ('lax' as const),
  path: '/',
  maxAge: maxAgeSeconds * 1000,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

function setAuthCookies(res: Response, tokens: authService.AuthTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenExpiresIn));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenExpiresIn));
}

const requestMeta = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
  requestId: req.requestId ?? null,
});

export const login = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.login(req.body, requestMeta(req));
  setAuthCookies(res, tokens);
  // The token pair is returned too, so non-browser clients need no cookie jar.
  return sendSuccess(res, { user, tokens });
});

export const refresh = asyncHandler(async (req, res) => {
  const token =
    (req.body?.refreshToken as string | undefined) ??
    (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!token) throw unauthenticated('No refresh token supplied');

  const { user, tokens } = await authService.refresh(token, requestMeta(req));
  setAuthCookies(res, tokens);
  return sendSuccess(res, { user, tokens });
});

export const logout = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await authService.logout(auth.sessionId, requestMeta(req));
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  return sendSuccess(res, { loggedOut: true });
});

export const me = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await authService.getCurrentUser(auth.userId));
});

export const sessions = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await authService.listSessions(auth.userId));
});

export const revokeSessions = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const revoked = await authService.revokeAllSessions(auth.userId, 'ADMIN_REVOKED');
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  return sendSuccess(res, { revoked });
});

export const changePassword = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await authService.changePassword(
    auth.userId,
    req.body.currentPassword,
    req.body.newPassword,
    requestMeta(req),
  );
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  void auditContext(req);
  return sendSuccess(res, { passwordChanged: true });
});

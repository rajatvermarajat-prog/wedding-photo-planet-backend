import { Request, Response } from 'express';
import { env } from '../config/env';
import { FREELANCER_ACCESS_COOKIE, FREELANCER_REFRESH_COOKIE } from '../middleware/freelancerAuth';
import { asyncHandler } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import { unauthenticated } from '../utils/errors';
import * as service from '../services/freelancerPortal.service';

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? ('none' as const) : ('lax' as const),
  path: '/',
  maxAge: maxAgeSeconds * 1000,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

function setCookies(res: Response, tokens: service.FreelancerTokens): void {
  res.cookie(FREELANCER_ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenExpiresIn));
  res.cookie(FREELANCER_REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenExpiresIn));
}

const meta = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
  requestId: req.requestId ?? null,
});

const freelancer = (req: Request) => {
  if (!req.freelancerAuth) throw unauthenticated('Freelancer authentication required');
  return req.freelancerAuth;
};

export const login = asyncHandler(async (req, res) => {
  const { me, tokens } = await service.login(req.body, meta(req));
  setCookies(res, tokens);
  return sendSuccess(res, { me, tokens });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[FREELANCER_REFRESH_COOKIE];
  if (!token) throw unauthenticated('No freelancer refresh token supplied');
  const { me, tokens } = await service.refresh(token, meta(req));
  setCookies(res, tokens);
  return sendSuccess(res, { me, tokens });
});

export const logout = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  await service.logout(auth.sessionId);
  res.clearCookie(FREELANCER_ACCESS_COOKIE, { path: '/' });
  res.clearCookie(FREELANCER_REFRESH_COOKIE, { path: '/' });
  return sendSuccess(res, { loggedOut: true });
});

export const submitApplication = asyncHandler(async (req, res) => {
  const { organizationSlug, ...input } = req.body;
  return sendCreated(res, await service.submitApplication(organizationSlug, input));
});

export const me = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendSuccess(res, await service.getPortalMe(auth.organizationId, auth.freelancerId));
});

export const updateProfile = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendSuccess(res, await service.updateProfile(auth.organizationId, auth.freelancerId, req.body));
});

export const setPassword = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  await service.setPassword(auth.organizationId, auth.freelancerId, req.body.password, {
    organizationId: auth.organizationId,
    actorId: null,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId ?? null,
  });
  return sendSuccess(res, { passwordSet: true });
});

export const upsertAvailability = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendSuccess(res, await service.upsertAvailability(auth.organizationId, auth.freelancerId, req.body));
});

export const createPortfolioItem = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendCreated(res, await service.createPortfolioItem(auth.organizationId, auth.freelancerId, req.body));
});

export const updatePortfolioItem = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendSuccess(res, await service.updatePortfolioItem(auth.organizationId, auth.freelancerId, req.params.itemId, req.body));
});

export const deletePortfolioItem = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  await service.deletePortfolioItem(auth.organizationId, auth.freelancerId, req.params.itemId);
  return sendNoContent(res);
});

export const listPlans = asyncHandler(async (req, res) => {
  const auth = freelancer(req);
  return sendSuccess(res, await service.listPlans(auth.organizationId));
});

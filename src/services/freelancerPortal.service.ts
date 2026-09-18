import { LogoutReason, Prisma, SessionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { badRequest, conflict, notFound, unauthenticated } from '../utils/errors';
import { generateRefreshToken, hashRefreshToken, parseDuration } from '../utils/jwt';
import { signFreelancerAccessToken } from '../utils/freelancerJwt';
import { hashPassword, verifyPassword } from '../utils/password';
import { AuditRequestContext, recordAudit } from './audit.service';
import { money } from '../utils/money';
import { isFreelancerSearchable } from './freelancer.service';
import { toDateOnly } from '../utils/date';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface FreelancerTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

async function issueSession(freelancerId: string, organizationId: string, meta: RequestMeta): Promise<FreelancerTokens> {
  const refreshTtl = parseDuration(env.REFRESH_TOKEN_EXPIRES_IN);
  const { token, hash } = generateRefreshToken();
  const session = await prisma.freelancerSession.create({
    data: {
      freelancerId,
      refreshTokenHash: hash,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      expiresAt: new Date(Date.now() + refreshTtl),
    },
    select: { id: true },
  });
  return {
    accessToken: signFreelancerAccessToken({ sub: freelancerId, organizationId, freelancerSessionId: session.id }),
    refreshToken: token,
    accessTokenExpiresIn: Math.floor(parseDuration(env.JWT_EXPIRES_IN) / 1000),
    refreshTokenExpiresIn: Math.floor(refreshTtl / 1000),
  };
}

const profileInclude = {
  subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' as const }, take: 5 },
  availability: { orderBy: { date: 'asc' as const }, take: 30 },
  portfolioItems: { include: { fileObject: true }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'desc' as const }] },
  applications: { orderBy: { createdAt: 'desc' as const }, take: 5 },
  connections: { orderBy: { createdAt: 'desc' as const }, take: 20 },
  assignments: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    include: { shoot: { select: { id: true, title: true, shootDate: true, status: true, project: { select: { id: true, projectNumber: true, name: true } } } } },
  },
  payouts: { orderBy: { paymentDate: 'desc' as const }, take: 20 },
} satisfies Prisma.FreelancerInclude;

export async function getPortalMe(organizationId: string, freelancerId: string) {
  const freelancer = await prisma.freelancer.findFirst({
    where: { id: freelancerId, organizationId, deletedAt: null },
    include: profileInclude,
  });
  if (!freelancer) throw notFound('Freelancer');
  const searchable = await isFreelancerSearchable(organizationId, freelancerId);
  return { freelancer, searchable };
}

export async function login(
  input: { identifier: string; password: string },
  meta: RequestMeta,
): Promise<{ me: Awaited<ReturnType<typeof getPortalMe>>; tokens: FreelancerTokens }> {
  const identifier = input.identifier.trim().toLowerCase();
  const freelancer = await prisma.freelancer.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: identifier }, { phone: identifier }, { whatsapp: identifier }],
    },
  });
  if (!freelancer?.passwordHash) throw unauthenticated('Invalid freelancer credentials');
  if (freelancer.lockedUntil && freelancer.lockedUntil > new Date()) {
    throw unauthenticated('Freelancer account is temporarily locked');
  }
  if (!(await verifyPassword(input.password, freelancer.passwordHash))) {
    const attempts = freelancer.failedLoginAttempts + 1;
    await prisma.freelancer.update({
      where: { id: freelancer.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    throw unauthenticated('Invalid freelancer credentials');
  }
  const [tokens] = await Promise.all([
    issueSession(freelancer.id, freelancer.organizationId, meta),
    prisma.freelancer.update({ where: { id: freelancer.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    recordAudit(prisma, {
      organizationId: freelancer.organizationId,
      actorId: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    }, { action: 'LOGIN', entityType: 'Freelancer', entityId: freelancer.id, summary: 'Freelancer signed in' }),
  ]);
  return { me: await getPortalMe(freelancer.organizationId, freelancer.id), tokens };
}

export async function refresh(refreshToken: string, meta: RequestMeta) {
  const session = await prisma.freelancerSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    include: { freelancer: true },
  });
  if (!session || session.status !== 'ACTIVE') throw unauthenticated('Invalid freelancer refresh token');
  if (session.expiresAt <= new Date()) {
    await prisma.freelancerSession.update({ where: { id: session.id }, data: { status: 'EXPIRED', revokedAt: new Date() } });
    throw unauthenticated('Freelancer session has expired');
  }
  await prisma.freelancerSession.update({
    where: { id: session.id },
    data: { status: SessionStatus.LOGGED_OUT, revokedAt: new Date(), revokeReason: LogoutReason.TOKEN_REFRESH_ROTATION },
  });
  const tokens = await issueSession(session.freelancerId, session.freelancer.organizationId, meta);
  return { me: await getPortalMe(session.freelancer.organizationId, session.freelancerId), tokens };
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.freelancerSession.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: { status: 'LOGGED_OUT', revokedAt: new Date(), revokeReason: 'MANUAL_LOGOUT' },
  });
}

export async function submitApplication(organizationSlug: string | undefined, input: {
  fullName: string;
  phone: string;
  email?: string;
  city?: string;
  primarySkill?: Prisma.FreelancerApplicationCreateInput['primarySkill'];
  skills?: string[];
  experienceYears?: number;
  portfolioUrl?: string;
  expectedRate?: Prisma.Decimal.Value;
  notes?: string;
}) {
  const organization = await prisma.organization.findFirst({
    where: organizationSlug ? { slug: organizationSlug, deletedAt: null } : { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!organization) throw notFound('Organization');
  const duplicate = await prisma.freelancerApplication.findFirst({
    where: {
      organizationId: organization.id,
      status: { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] },
      OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email.toLowerCase() }] : [])],
    },
    select: { id: true },
  });
  if (duplicate) throw conflict('An active freelancer application already exists for this applicant');
  return prisma.freelancerApplication.create({
    data: {
      organizationId: organization.id,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email?.toLowerCase(),
      city: input.city,
      primarySkill: input.primarySkill ?? 'LEAD_PHOTOGRAPHER',
      skills: input.skills ?? [],
      experienceYears: input.experienceYears,
      portfolioUrl: input.portfolioUrl,
      expectedRate: input.expectedRate === undefined ? undefined : money(input.expectedRate),
      notes: input.notes,
      status: 'SUBMITTED',
    },
  });
}

export async function updateProfile(organizationId: string, freelancerId: string, input: Prisma.FreelancerUpdateInput) {
  return prisma.freelancer.update({
    where: { id: freelancerId, organizationId, deletedAt: null },
    data: input,
  });
}

export async function setPassword(organizationId: string, freelancerId: string, password: string, ctx: AuditRequestContext) {
  const freelancer = await prisma.freelancer.findFirst({ where: { id: freelancerId, organizationId, deletedAt: null } });
  if (!freelancer) throw notFound('Freelancer');
  await prisma.freelancer.update({ where: { id: freelancerId }, data: { passwordHash: await hashPassword(password) } });
  await recordAudit(prisma, ctx, { action: 'UPDATE', entityType: 'Freelancer', entityId: freelancerId, summary: 'Freelancer portal password set' });
}

export async function upsertAvailability(organizationId: string, freelancerId: string, input: {
  date: string;
  status: 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'UNAVAILABLE';
  startTime?: Date | null;
  endTime?: Date | null;
  notes?: string | null;
}) {
  if (input.startTime && input.endTime && input.endTime < input.startTime) {
    throw badRequest('endTime cannot be before startTime');
  }
  const date = toDateOnly(input.date);
  return prisma.freelancerAvailability.upsert({
    where: { freelancerId_date: { freelancerId, date } },
    create: { freelancerId, date, status: input.status, startTime: input.startTime, endTime: input.endTime, notes: input.notes },
    update: { status: input.status, startTime: input.startTime, endTime: input.endTime, notes: input.notes },
  });
}

export async function createPortfolioItem(organizationId: string, freelancerId: string, input: {
  fileObjectId: string;
  title: string;
  description?: string;
  category?: string;
  sortOrder?: number;
  isPublished?: boolean;
}) {
  const file = await prisma.fileObject.findFirst({ where: { id: input.fileObjectId, organizationId, deletedAt: null }, select: { id: true } });
  if (!file) throw notFound('File');
  return prisma.freelancerPortfolioItem.create({ data: { freelancerId, ...input } });
}

export async function updatePortfolioItem(organizationId: string, freelancerId: string, itemId: string, input: Prisma.FreelancerPortfolioItemUpdateInput) {
  const existing = await prisma.freelancerPortfolioItem.findFirst({ where: { id: itemId, freelancerId, freelancer: { organizationId } } });
  if (!existing) throw notFound('Freelancer portfolio item');
  return prisma.freelancerPortfolioItem.update({ where: { id: itemId }, data: input });
}

export async function deletePortfolioItem(organizationId: string, freelancerId: string, itemId: string) {
  const existing = await prisma.freelancerPortfolioItem.findFirst({ where: { id: itemId, freelancerId, freelancer: { organizationId } } });
  if (!existing) throw notFound('Freelancer portfolio item');
  await prisma.freelancerPortfolioItem.delete({ where: { id: itemId } });
}

export async function listPlans(organizationId: string) {
  return prisma.freelancerPlan.findMany({ where: { organizationId, isActive: true }, orderBy: { price: 'asc' } });
}

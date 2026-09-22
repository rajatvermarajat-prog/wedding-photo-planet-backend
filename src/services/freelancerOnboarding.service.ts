import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma, Tx } from '../config/prisma';
import { badRequest, conflict, unauthenticated } from '../utils/errors';
import { generateRefreshToken, hashRefreshToken, parseDuration } from '../utils/jwt';
import { hashPassword } from '../utils/password';
import { AuditRequestContext, recordAudit } from './audit.service';

type OnboardingStatus = 'valid' | 'invalid' | 'expired' | 'used' | 'revoked';

const safeSelect = {
  id: true,
  expiresAt: true,
  usedAt: true,
  invalidatedAt: true,
  freelancer: {
    select: {
      id: true,
      organizationId: true,
      fullName: true,
      email: true,
      phone: true,
      deletedAt: true,
      status: true,
    },
  },
  application: {
    select: {
      id: true,
      status: true,
    },
  },
} satisfies Prisma.FreelancerOnboardingTokenSelect;

function onboardingPath(token: string): string {
  return `/freelancer/onboarding?token=${encodeURIComponent(token)}`;
}

function classify(row: Prisma.FreelancerOnboardingTokenGetPayload<{ select: typeof safeSelect }> | null, now = new Date()): OnboardingStatus {
  if (!row || row.freelancer.deletedAt || row.freelancer.status === 'SUSPENDED' || row.freelancer.status === 'INACTIVE') return 'invalid';
  if (row.invalidatedAt) return 'revoked';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'valid';
}

export async function createOnboardingInvitation(
  tx: Tx,
  input: {
    organizationId: string;
    freelancerId: string;
    applicationId?: string | null;
    createdById?: string | null;
  },
  ctx: AuditRequestContext,
) {
  const now = new Date();
  const ttlMs = parseDuration(env.FREELANCER_ONBOARDING_TOKEN_EXPIRES_IN);
  const { token, hash } = generateRefreshToken();

  const invalidated = await tx.freelancerOnboardingToken.updateMany({
    where: {
      freelancerId: input.freelancerId,
      usedAt: null,
      invalidatedAt: null,
    },
    data: { invalidatedAt: now },
  });

  const invitation = await tx.freelancerOnboardingToken.create({
    data: {
      freelancerId: input.freelancerId,
      applicationId: input.applicationId ?? null,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + ttlMs),
      createdById: input.createdById ?? null,
    },
    select: { id: true, expiresAt: true, freelancerId: true, applicationId: true },
  });

  if (invalidated.count > 0) {
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'FreelancerOnboardingToken',
      entityId: invitation.id,
      summary: 'Previous freelancer onboarding invitation invalidated',
      newData: { freelancerId: input.freelancerId, invalidatedCount: invalidated.count },
    });
  }

  await recordAudit(tx, ctx, {
    action: 'CREATE',
    entityType: 'FreelancerOnboardingToken',
    entityId: invitation.id,
    summary: 'Freelancer onboarding invitation created',
    newData: {
      freelancerId: input.freelancerId,
      applicationId: input.applicationId ?? null,
      expiresAt: invitation.expiresAt,
    },
  });

  return {
    invitation,
    rawToken: token,
    invitationPath: onboardingPath(token),
  };
}

export async function validateOnboardingToken(token: string) {
  const row = await prisma.freelancerOnboardingToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
    select: safeSelect,
  });
  const status = classify(row);
  if (status !== 'valid' || !row) return { valid: false, status };
  return {
    valid: true,
    status,
    freelancer: {
      displayName: row.freelancer.fullName,
      email: row.freelancer.email,
    },
    expiresAt: row.expiresAt,
  };
}

export async function setOnboardingPassword(
  token: string,
  input: { password: string; confirmPassword?: string },
  meta: { ipAddress?: string | null; userAgent?: string | null; requestId?: string | null },
) {
  if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) {
    throw badRequest('Passwords do not match');
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.freelancerOnboardingToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      select: safeSelect,
    });
    const status = classify(row);
    if (!row || status === 'invalid') throw unauthenticated('Invalid onboarding invitation');
    if (status === 'expired') throw unauthenticated('This onboarding invitation has expired');
    if (status === 'used') throw conflict('This onboarding invitation has already been used');
    if (status === 'revoked') throw unauthenticated('Invalid onboarding invitation');

    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    await tx.freelancer.update({
      where: { id: row.freelancer.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.freelancerOnboardingToken.update({
      where: { id: row.id },
      data: { usedAt: now },
    });
    await tx.freelancerOnboardingToken.updateMany({
      where: {
        freelancerId: row.freelancer.id,
        id: { not: row.id },
        usedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
    await recordAudit(tx, {
      organizationId: row.freelancer.organizationId,
      actorId: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    }, {
      action: 'UPDATE',
      entityType: 'Freelancer',
      entityId: row.freelancer.id,
      summary: 'Freelancer onboarding password created',
      newData: { onboardingTokenId: row.id, applicationId: row.application?.id ?? null },
    });

    return { passwordSet: true };
  });
}

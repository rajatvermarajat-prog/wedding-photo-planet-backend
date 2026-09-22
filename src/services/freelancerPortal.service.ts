import { FreelancerConnectionStatus, LogoutReason, Prisma, SessionStatus, TaskStatus } from '@prisma/client';
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
import { resolvePagination } from '../utils/pagination';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const PORTAL_PORTFOLIO_FILE_TYPES = new Set(['FREELANCER', 'FREELANCER_DOCUMENT', 'FREELANCER_PORTFOLIO']);
const OPEN_TASK_STATUSES: TaskStatus[] = ['TODO', 'ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'IN_REVIEW'];
const ACTIVE_CONNECTION_STATUSES: FreelancerConnectionStatus[] = ['INTERESTED', 'CONTACTED', 'ACCEPTED', 'ASSIGNED'];

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

type PortalFreelancerRecord = Prisma.FreelancerGetPayload<{ include: typeof profileInclude }>;

const safeFileObject = (file: PortalFreelancerRecord['portfolioItems'][number]['fileObject']) => file && ({
  id: file.id,
  originalName: file.originalName,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  createdAt: file.createdAt,
});

function toPortalFreelancer(freelancer: PortalFreelancerRecord) {
  return {
    id: freelancer.id,
    code: freelancer.code,
    fullName: freelancer.fullName,
    phone: freelancer.phone,
    whatsapp: freelancer.whatsapp,
    email: freelancer.email,
    city: freelancer.city,
    addressLine: freelancer.addressLine,
    primarySkill: freelancer.primarySkill,
    skills: freelancer.skills,
    experienceYears: freelancer.experienceYears,
    rate: freelancer.rate,
    rateType: freelancer.rateType,
    travelAvailable: freelancer.travelAvailable,
    maxShootsPerDay: freelancer.maxShootsPerDay,
    rating: freelancer.rating,
    status: freelancer.status,
    equipmentNotes: freelancer.equipmentNotes,
    notes: freelancer.notes,
    createdAt: freelancer.createdAt,
    updatedAt: freelancer.updatedAt,
    subscriptions: freelancer.subscriptions,
    availability: freelancer.availability,
    portfolioItems: freelancer.portfolioItems.map((item) => ({
      id: item.id,
      fileObjectId: item.fileObjectId,
      title: item.title,
      description: item.description,
      category: item.category,
      sortOrder: item.sortOrder,
      isPublished: item.isPublished,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      fileObject: safeFileObject(item.fileObject),
    })),
    applications: freelancer.applications.map((application) => ({
      id: application.id,
      status: application.status,
      rejectionReason: application.rejectionReason,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    })),
    connections: freelancer.connections,
    assignments: freelancer.assignments,
    payouts: freelancer.payouts,
  };
}

export async function getPortalMe(organizationId: string, freelancerId: string) {
  const freelancer = await prisma.freelancer.findFirst({
    where: { id: freelancerId, organizationId, deletedAt: null },
    include: profileInclude,
  });
  if (!freelancer) throw notFound('Freelancer');
  const searchable = await isFreelancerSearchable(organizationId, freelancerId);
  return { freelancer: toPortalFreelancer(freelancer), searchable };
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

export async function submitApplication(input: {
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
    where: { deletedAt: null },
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
  await prisma.freelancer.update({
    where: { id: freelancerId, organizationId, deletedAt: null },
    data: input,
  });
  return (await getPortalMe(organizationId, freelancerId)).freelancer;
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
  const file = await prisma.fileObject.findFirst({
    where: {
      id: input.fileObjectId,
      organizationId,
      deletedAt: null,
      entityType: { in: [...PORTAL_PORTFOLIO_FILE_TYPES] },
      OR: [{ entityId: null }, { entityId: freelancerId }],
    },
    select: { id: true },
  });
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

const projectSummarySelect = {
  id: true,
  projectNumber: true,
  name: true,
  type: true,
  status: true,
  weddingDate: true,
  venueName: true,
  venueCity: true,
  createdAt: true,
} satisfies Prisma.ProjectSelect;

const shootSummarySelect = {
  id: true,
  title: true,
  shootType: true,
  shootDate: true,
  startTime: true,
  endTime: true,
  location: true,
  city: true,
  status: true,
  project: { select: projectSummarySelect },
  assignments: {
    select: {
      id: true,
      freelancerId: true,
      userId: true,
      role: true,
      status: true,
      callTime: true,
      assignedAt: true,
      user: { select: { id: true, fullName: true, employeeCode: true } },
      freelancer: { select: { id: true, fullName: true, code: true, primarySkill: true } },
    },
  },
} satisfies Prisma.ShootSelect;

const taskSummarySelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  status: true,
  priority: true,
  dueDate: true,
  startedAt: true,
  completedAt: true,
  project: { select: projectSummarySelect },
  shoot: { select: { id: true, title: true, shootDate: true, startTime: true, endTime: true, location: true, city: true, status: true } },
} satisfies Prisma.TaskSelect;

const payoutSummarySelect = {
  id: true,
  amount: true,
  paymentDate: true,
  paymentMethod: true,
  transactionRef: true,
  createdAt: true,
  assignment: {
    select: {
      id: true,
      role: true,
      status: true,
      shoot: { select: { id: true, title: true, shootDate: true, project: { select: projectSummarySelect } } },
    },
  },
} satisfies Prisma.FreelancerPayoutSelect;

function assignmentWhere(organizationId: string, freelancerId: string): Prisma.ShootAssignmentWhereInput {
  return {
    freelancerId,
    shoot: { organizationId, deletedAt: null, project: { organizationId, deletedAt: null } },
  };
}

function projectAccessWhere(organizationId: string, freelancerId: string): Prisma.ProjectWhereInput {
  return {
    organizationId,
    deletedAt: null,
    OR: [
      { shoots: { some: { deletedAt: null, assignments: { some: { freelancerId } } } } },
      { freelancerConnections: { some: { freelancerId, status: { in: ACTIVE_CONNECTION_STATUSES } } } },
    ],
  };
}

function taskAccessWhere(organizationId: string, freelancerId: string): Prisma.TaskWhereInput {
  return {
    organizationId,
    deletedAt: null,
    OR: [
      { shoot: { deletedAt: null, assignments: { some: { freelancerId } } } },
      { project: projectAccessWhere(organizationId, freelancerId) },
    ],
  };
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function cleanCrew(assignments: Prisma.ShootGetPayload<{ select: typeof shootSummarySelect }>['assignments'], freelancerId: string) {
  return assignments.map((assignment) => ({
    id: assignment.id,
    role: assignment.role,
    status: assignment.status,
    isSelf: assignment.freelancerId === freelancerId,
    displayName: assignment.freelancerId === freelancerId
      ? assignment.freelancer?.fullName
      : assignment.user?.fullName ?? assignment.freelancer?.fullName ?? 'Crew member',
  }));
}

function toShootSummary(shoot: Prisma.ShootGetPayload<{ select: typeof shootSummarySelect }>, freelancerId: string) {
  const ownAssignment = shoot.assignments.find((assignment) => assignment.freelancerId === freelancerId);
  return {
    id: shoot.id,
    title: shoot.title,
    shootType: shoot.shootType,
    shootDate: shoot.shootDate,
    startTime: shoot.startTime,
    endTime: shoot.endTime,
    location: shoot.location,
    city: shoot.city,
    status: shoot.status,
    project: shoot.project,
    assignment: ownAssignment && {
      id: ownAssignment.id,
      role: ownAssignment.role,
      status: ownAssignment.status,
      callTime: ownAssignment.callTime,
      assignedAt: ownAssignment.assignedAt,
    },
    crew: cleanCrew(shoot.assignments, freelancerId),
  };
}

function toTaskSummary(task: Prisma.TaskGetPayload<{ select: typeof taskSummarySelect }>) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    project: task.project,
    shoot: task.shoot,
  };
}

function toPayoutSummary(payout: Prisma.FreelancerPayoutGetPayload<{ select: typeof payoutSummarySelect }>) {
  return {
    id: payout.id,
    amount: payout.amount,
    paymentDate: payout.paymentDate,
    paymentMethod: payout.paymentMethod,
    transactionRef: payout.transactionRef,
    createdAt: payout.createdAt,
    assignment: payout.assignment,
  };
}

function paginationMeta(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export async function getDashboard(organizationId: string, freelancerId: string) {
  const now = new Date();
  const { start, end } = todayBounds();
  const [me, upcomingShoots, todayShoots, tasks, payouts, notifications] = await Promise.all([
    getPortalMe(organizationId, freelancerId),
    prisma.shoot.findMany({
      where: { assignments: { some: assignmentWhere(organizationId, freelancerId) }, shootDate: { gte: now }, deletedAt: null },
      select: shootSummarySelect,
      orderBy: [{ shootDate: 'asc' }, { startTime: 'asc' }],
      take: 5,
    }),
    prisma.shoot.findMany({
      where: { assignments: { some: assignmentWhere(organizationId, freelancerId) }, shootDate: { gte: start, lt: end }, deletedAt: null },
      select: shootSummarySelect,
      orderBy: [{ startTime: 'asc' }],
      take: 5,
    }),
    prisma.task.findMany({
      where: { ...taskAccessWhere(organizationId, freelancerId), status: { in: OPEN_TASK_STATUSES } },
      select: taskSummarySelect,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    }),
    prisma.freelancerPayout.findMany({
      where: { organizationId, freelancerId },
      select: payoutSummarySelect,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    }),
    prisma.notification.findMany({
      where: { organizationId, userId: freelancerId },
      select: { id: true, type: true, title: true, message: true, entityType: true, entityId: true, isRead: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);
  const paidAmount = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
  return {
    profile: { freelancer: me.freelancer, searchable: me.searchable },
    subscription: me.freelancer.subscriptions[0] ?? null,
    upcomingShoots: upcomingShoots.map((shoot) => toShootSummary(shoot, freelancerId)),
    todaysWork: {
      shoots: todayShoots.map((shoot) => toShootSummary(shoot, freelancerId)),
      tasks: tasks.filter((task) => task.dueDate && task.dueDate >= start && task.dueDate < end).map(toTaskSummary),
    },
    tasks: tasks.map(toTaskSummary),
    payments: { recent: payouts.map(toPayoutSummary), summary: { paidAmount, currency: me.freelancer.subscriptions[0]?.plan.currency ?? 'INR' } },
    notifications,
  };
}

export async function listProjects(organizationId: string, freelancerId: string, query: { page?: number; limit?: number; search?: string; status?: string }) {
  const { page, limit, skip, take } = resolvePagination(query);
  const where: Prisma.ProjectWhereInput = {
    ...projectAccessWhere(organizationId, freelancerId),
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      select: {
        ...projectSummarySelect,
        shoots: {
          where: { deletedAt: null, assignments: { some: { freelancerId } } },
          select: { id: true, title: true, shootDate: true, status: true },
          orderBy: { shootDate: 'asc' },
          take: 3,
        },
      },
      orderBy: [{ weddingDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
  ]);
  return { items: rows, meta: paginationMeta(total, page, limit) };
}

export async function getProject(organizationId: string, freelancerId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { ...projectAccessWhere(organizationId, freelancerId), id: projectId },
    select: {
      ...projectSummarySelect,
      venueAddress: true,
      shoots: {
        where: { deletedAt: null, assignments: { some: { freelancerId } } },
        select: shootSummarySelect,
        orderBy: { shootDate: 'asc' },
      },
      tasks: {
        where: taskAccessWhere(organizationId, freelancerId),
        select: taskSummarySelect,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 20,
      },
    },
  });
  if (!project) throw notFound('Project');
  return { ...project, shoots: project.shoots.map((shoot) => toShootSummary(shoot, freelancerId)), tasks: project.tasks.map(toTaskSummary) };
}

export async function listShoots(organizationId: string, freelancerId: string, query: { page?: number; limit?: number; view?: string; search?: string }) {
  const { page, limit, skip, take } = resolvePagination(query);
  const { start, end } = todayBounds();
  const now = new Date();
  const where: Prisma.ShootWhereInput = {
    assignments: { some: assignmentWhere(organizationId, freelancerId) },
    deletedAt: null,
    ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.view === 'today' ? { shootDate: { gte: start, lt: end } } : {}),
    ...(query.view === 'completed' ? { OR: [{ status: 'COMPLETED' }, { shootDate: { lt: start } }] } : {}),
    ...(!query.view || query.view === 'upcoming' ? { shootDate: { gte: now } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.shoot.count({ where }),
    prisma.shoot.findMany({ where, select: shootSummarySelect, orderBy: [{ shootDate: 'asc' }, { startTime: 'asc' }], skip, take }),
  ]);
  return { items: rows.map((shoot) => toShootSummary(shoot, freelancerId)), meta: paginationMeta(total, page, limit) };
}

export async function getShoot(organizationId: string, freelancerId: string, shootId: string) {
  const shoot = await prisma.shoot.findFirst({
    where: { id: shootId, assignments: { some: assignmentWhere(organizationId, freelancerId) }, deletedAt: null },
    select: {
      ...shootSummarySelect,
      notes: true,
      event: { select: { id: true, name: true, eventDate: true, venueName: true, city: true, status: true } },
      tasks: {
        where: taskAccessWhere(organizationId, freelancerId),
        select: taskSummarySelect,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 20,
      },
    },
  });
  if (!shoot) throw notFound('Shoot');
  return { ...toShootSummary(shoot, freelancerId), notes: shoot.notes, event: shoot.event, tasks: shoot.tasks.map(toTaskSummary) };
}

export async function listTasks(organizationId: string, freelancerId: string, query: { page?: number; limit?: number; status?: TaskStatus; search?: string }) {
  const { page, limit, skip, take } = resolvePagination(query);
  const where: Prisma.TaskWhereInput = {
    ...taskAccessWhere(organizationId, freelancerId),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({ where, select: taskSummarySelect, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], skip, take }),
  ]);
  return { items: rows.map(toTaskSummary), meta: paginationMeta(total, page, limit) };
}

export async function updateTaskStatus(organizationId: string, freelancerId: string, taskId: string, status: TaskStatus, ctx: AuditRequestContext) {
  const existing = await prisma.task.findFirst({ where: { ...taskAccessWhere(organizationId, freelancerId), id: taskId }, select: { id: true, status: true } });
  if (!existing) throw notFound('Task');
  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        startedAt: status === 'IN_PROGRESS' ? new Date() : undefined,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
        statusHistory: { create: { oldStatus: existing.status, newStatus: status, reason: 'Updated from freelancer portal' } },
      },
      select: taskSummarySelect,
    });
    await recordAudit(tx, ctx, { action: 'UPDATE', entityType: 'Task', entityId: taskId, summary: 'Freelancer updated task status' });
    return task;
  });
  return toTaskSummary(updated);
}

export async function listPayments(organizationId: string, freelancerId: string, query: { page?: number; limit?: number }) {
  const { page, limit, skip, take } = resolvePagination(query);
  const where: Prisma.FreelancerPayoutWhereInput = { organizationId, freelancerId };
  const [total, rows] = await Promise.all([
    prisma.freelancerPayout.count({ where }),
    prisma.freelancerPayout.findMany({ where, select: payoutSummarySelect, orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }], skip, take }),
  ]);
  return { items: rows.map(toPayoutSummary), meta: paginationMeta(total, page, limit) };
}

export async function listNotifications(organizationId: string, freelancerId: string, query: { page?: number; limit?: number; unreadOnly?: boolean }) {
  const { page, limit, skip, take } = resolvePagination(query);
  const where: Prisma.NotificationWhereInput = { organizationId, userId: freelancerId, ...(query.unreadOnly ? { isRead: false } : {}) };
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: { id: true, type: true, channel: true, title: true, message: true, entityType: true, entityId: true, isRead: true, readAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  return { items: rows, meta: paginationMeta(total, page, limit) };
}

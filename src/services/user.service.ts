import { UserStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { hashPassword } from '../utils/password';
import { badRequest, conflict } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';
import { revokeAllSessions } from './auth.service';

const SORTABLE = ['createdAt', 'fullName', 'email', 'lastLoginAt'] as const;

const PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  branchId: true,
  employeeCode: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  userRoles: { select: { role: { select: { id: true, name: true, type: true } } } },
  employeeProfile: {
    select: {
      id: true,
      employmentType: true,
      joiningDate: true,
      workLocation: true,
      skills: true,
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, title: true } },
    },
  },
} as const;

export function listUsers(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: UserStatus;
    branchId?: string;
    roleId?: string;
    departmentId?: string;
    sortBy?: string;
    sortOrder?: string;
  },
) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'createdAt');
  return paginate(prisma.user, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.status ? { status: query.status } : undefined,
      query.branchId ? { branchId: query.branchId } : undefined,
      query.roleId ? { userRoles: { some: { roleId: query.roleId } } } : undefined,
      query.departmentId
        ? { employeeProfile: { departmentId: query.departmentId } }
        : undefined,
      searchFilter(query.search, ['fullName', 'email', 'employeeCode', 'phone']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    select: PUBLIC_SELECT,
  });
}

export function getUser(organizationId: string, id: string) {
  // PUBLIC_SELECT deliberately omits passwordHash — it never leaves the DB (§37).
  return findScoped(prisma.user, organizationId, id, 'User', { select: PUBLIC_SELECT });
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  employeeCode?: string;
  branchId?: string;
  roleIds: string[];
  profile?: {
    departmentId?: string;
    designationId?: string;
    employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
    joiningDate?: Date;
    monthlySalary?: number;
    dailyRate?: number;
    workLocation?: 'OFFICE' | 'WFH' | 'HYBRID' | 'ON_SHOOT';
    skills?: string[];
    reportingManagerId?: string;
  };
}

export async function createUser(auth: AuthContext, input: CreateUserInput, ctx: AuditRequestContext) {
  if (input.roleIds.length === 0) throw badRequest('At least one role must be assigned');

  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (roles.length !== input.roleIds.length) throw badRequest('One or more roles are invalid');

    const email = input.email.toLowerCase();
    const existing = await tx.user.findFirst({
      where: { organizationId: auth.organizationId, email },
      select: { id: true },
    });
    if (existing) throw conflict('A user with this email already exists in the organization');

    const user = await tx.user.create({
      data: {
        organizationId: auth.organizationId,
        branchId: input.branchId,
        fullName: input.fullName,
        email,
        phone: input.phone,
        employeeCode: input.employeeCode,
        passwordHash: await hashPassword(input.password),
        userRoles: {
          createMany: {
            data: input.roleIds.map((roleId) => ({ roleId, assignedBy: auth.userId })),
          },
        },
        employeeProfile: input.profile ? { create: input.profile } : undefined,
      },
      select: PUBLIC_SELECT,
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      summary: `User ${email} created`,
      newData: user,
    });

    return user;
  });
}

export async function updateUser(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateUserInput, 'password' | 'roleIds' | 'email'>> & { status?: UserStatus },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<{ id: string; status: UserStatus }>(
      tx.user,
      auth.organizationId,
      id,
      'User',
      { select: { id: true, status: true } },
    );

    const updated = await tx.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        employeeCode: input.employeeCode,
        branchId: input.branchId,
        status: input.status,
        employeeProfile: input.profile
          ? { upsert: { create: input.profile, update: input.profile } }
          : undefined,
      },
      select: PUBLIC_SELECT,
    });

    // Deactivating an account must take effect immediately, not at token expiry.
    if (input.status && input.status !== 'ACTIVE' && existing.status === 'ACTIVE') {
      await revokeAllSessions(id);
    }

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      summary: 'User updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

export async function setUserRoles(
  auth: AuthContext,
  id: string,
  roleIds: string[],
  ctx: AuditRequestContext,
) {
  if (roleIds.length === 0) throw badRequest('A user must keep at least one role');

  return prisma.$transaction(async (tx) => {
    await findScoped(tx.user, auth.organizationId, id, 'User', { select: { id: true } });

    const roles = await tx.role.findMany({
      where: { id: { in: roleIds }, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (roles.length !== roleIds.length) throw badRequest('One or more roles are invalid');

    const before = await tx.userRole.findMany({
      where: { userId: id },
      select: { role: { select: { name: true } } },
    });

    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId: id, roleId, assignedBy: auth.userId })),
    });

    await recordAudit(tx, ctx, {
      action: 'ROLE_CHANGED',
      entityType: 'User',
      entityId: id,
      summary: `Roles set to ${roles.map((r) => r.name).join(', ')}`,
      oldData: { roles: before.map((b) => b.role.name) },
      newData: { roles: roles.map((r) => r.name) },
    });

    return getUser(auth.organizationId, id);
  });
}

export async function resetUserPassword(
  auth: AuthContext,
  id: string,
  newPassword: string,
  ctx: AuditRequestContext,
) {
  const user = await findScoped<{ id: string; email: string }>(
    prisma.user,
    auth.organizationId,
    id,
    'User',
    { select: { id: true, email: true } },
  );

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });
  await revokeAllSessions(id, 'PASSWORD_CHANGED');

  await recordAudit(prisma, ctx, {
    action: 'UPDATE',
    entityType: 'User',
    entityId: id,
    summary: `Password reset for ${user.email}; sessions revoked`,
  });
}

export async function deleteUser(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  if (id === auth.userId) throw conflict('You cannot delete your own account');

  return prisma.$transaction(async (tx) => {
    const user = await findScoped<{ id: string; email: string }>(
      tx.user,
      auth.organizationId,
      id,
      'User',
      { select: { id: true, email: true } },
    );

    await tx.user.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId, status: UserStatus.DISABLED },
    });
    await revokeAllSessions(id);

    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'User',
      entityId: id,
      summary: `User ${user.email} archived`,
      oldData: user,
    });
  });
}

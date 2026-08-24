import { RoleType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { badRequest, conflict, notFound } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

export function listRoles(organizationId: string) {
  return prisma.role.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      rolePermissions: { select: { permission: { select: { key: true, module: true } } } },
      _count: { select: { userRoles: true } },
    },
  });
}

export function listPermissions() {
  return prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
}

export async function getRole(organizationId: string, id: string) {
  const role = await prisma.role.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      rolePermissions: { include: { permission: true } },
      _count: { select: { userRoles: true } },
    },
  });
  if (!role) throw notFound('Role');
  return role;
}

export async function createRole(
  auth: AuthContext,
  input: { name: string; description?: string; permissionKeys: string[] },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const permissions = await tx.permission.findMany({
      where: { key: { in: input.permissionKeys } },
      select: { id: true, key: true },
    });
    if (permissions.length !== input.permissionKeys.length) {
      const found = new Set(permissions.map((p) => p.key));
      throw badRequest('Unknown permission key', [
        {
          field: 'permissionKeys',
          message: input.permissionKeys.filter((k) => !found.has(k)).join(', '),
        },
      ]);
    }

    const role = await tx.role.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        description: input.description,
        type: RoleType.CUSTOM,
        rolePermissions: {
          createMany: { data: permissions.map((p) => ({ permissionId: p.id })) },
        },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Role',
      entityId: role.id,
      summary: `Role ${role.name} created with ${permissions.length} permission(s)`,
      newData: { name: role.name, permissions: input.permissionKeys },
    });

    return role;
  });
}

/**
 * Replaces a role's permission set. The diff is captured in the audit trail so
 * a privilege escalation is always traceable to an actor (§24).
 */
export async function setRolePermissions(
  auth: AuthContext,
  id: string,
  permissionKeys: string[],
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: { id, organizationId: auth.organizationId, deletedAt: null },
      include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
    });
    if (!role) throw notFound('Role');
    if (role.type === RoleType.SYSTEM && role.name === 'ADMIN') {
      throw conflict('The ADMIN role always holds every permission and cannot be narrowed');
    }

    const permissions = await tx.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });
    if (permissions.length !== permissionKeys.length) {
      throw badRequest('One or more permission keys are unknown');
    }

    const before = role.rolePermissions.map((rp) => rp.permission.key).sort();
    const after = [...permissionKeys].sort();
    const added = after.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !after.includes(k));

    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
    });

    await recordAudit(tx, ctx, {
      action: 'PERMISSION_CHANGED',
      entityType: 'Role',
      entityId: id,
      summary: `Role ${role.name}: +${added.length} / -${removed.length} permissions`,
      oldData: { permissions: before },
      newData: { permissions: after, added, removed },
    });

    return getRole(auth.organizationId, id);
  });
}

export async function updateRole(
  auth: AuthContext,
  id: string,
  input: { name?: string; description?: string },
  ctx: AuditRequestContext,
) {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
  });
  if (!role) throw notFound('Role');
  if (role.type === RoleType.SYSTEM && input.name && input.name !== role.name) {
    throw conflict('A system role cannot be renamed');
  }

  const updated = await prisma.role.update({ where: { id }, data: input });
  await recordAudit(prisma, ctx, {
    action: 'UPDATE',
    entityType: 'Role',
    entityId: id,
    summary: 'Role updated',
    oldData: role,
    newData: updated,
  });
  return updated;
}

export async function deleteRole(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
    include: { _count: { select: { userRoles: true } } },
  });
  if (!role) throw notFound('Role');
  if (role.type === RoleType.SYSTEM) throw conflict('A system role cannot be deleted');
  if (role._count.userRoles > 0) {
    throw conflict(`This role is still assigned to ${role._count.userRoles} user(s)`);
  }

  await prisma.role.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: auth.userId },
  });
  await recordAudit(prisma, ctx, {
    action: 'SOFT_DELETE',
    entityType: 'Role',
    entityId: id,
    summary: `Role ${role.name} deleted`,
    oldData: role,
  });
}

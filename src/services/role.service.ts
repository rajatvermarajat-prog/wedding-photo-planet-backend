import { Permission, RoleStatus, RoleType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { TtlCache } from '../utils/cache';
import { withAlwaysGranted } from '../types/permissions';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

/**
 * A role is assignable by an actor only if the actor already holds every
 * permission the role grants. Without this an account with `USER_MANAGE` could
 * hand out ADMIN and escalate itself through a colleague (§16).
 */
function isAssignableBy(auth: AuthContext, permissionKeys: string[]): boolean {
  return permissionKeys.every((key) => auth.permissions.has(key));
}

/**
 * An actor cannot grant authority it does not itself hold, which stops a
 * `ROLE_CREATE` holder from minting an administrator-equivalent role.
 */
function assertCanGrant(auth: AuthContext, permissionKeys: string[]): void {
  const escalating = permissionKeys.filter((key) => !auth.permissions.has(key));
  if (escalating.length > 0) {
    throw forbidden(
      `You cannot grant permissions you do not hold: ${escalating.sort().join(', ')}`,
    );
  }
}

/**
 * The permission catalogue is seeded, immutable at runtime and read by every
 * role screen, so it is held in process instead of costing a round trip to the
 * database each time. A short TTL keeps a deploy that adds permissions honest.
 */
const catalogueCache = new TtlCache<Promise<Permission[]>>(10 * 60_000, 1);

function permissionCatalogue(): Promise<Permission[]> {
  const cached = catalogueCache.get('all');
  if (cached) return cached;
  const loading = prisma.permission
    .findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] })
    .catch((error: unknown) => {
      // Never cache a failure, or one blip would break roles for ten minutes.
      catalogueCache.delete('all');
      throw error;
    });
  catalogueCache.set('all', loading);
  return loading;
}

/** Resolves permission keys to rows, rejecting anything unknown. */
async function resolvePermissions(keys: string[]): Promise<Permission[]> {
  const catalogue = await permissionCatalogue();
  const byKey = new Map(catalogue.map((permission) => [permission.key, permission]));
  const unknown = keys.filter((key) => !byKey.has(key));
  if (unknown.length > 0) {
    throw badRequest('Unknown permission key', [
      { field: 'permissionKeys', message: unknown.sort().join(', ') },
    ]);
  }
  return keys.map((key) => byKey.get(key)!);
}

export async function listRoles(auth: AuthContext) {
  const roles = await prisma.role.findMany({
    where: { organizationId: auth.organizationId, deletedAt: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      // Keys only: the client already holds the catalogue, so shipping each
      // permission's module again just inflates the payload.
      rolePermissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { userRoles: true } },
    },
  });
  // One query, then a pure in-memory check — the actor's permissions are
  // already on the request, so this costs no extra round trip (§27).
  return roles.map((role) => ({
    ...role,
    assignable:
      role.status === RoleStatus.ACTIVE &&
      isAssignableBy(auth, role.rolePermissions.map((rp) => rp.permission.key)),
  }));
}

/**
 * The employees currently holding a role. Powers the per-role people list, so
 * an admin can see exactly who a permission change will affect.
 */
export async function listRoleUsers(organizationId: string, roleId: string) {
  // Scoped lookup first: a role from another studio must read as missing.
  await getRole(organizationId, roleId);
  const assignments = await prisma.userRole.findMany({
    where: { roleId, user: { organizationId, deletedAt: null } },
    orderBy: { user: { fullName: 'asc' } },
    select: {
      createdAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          employeeCode: true,
          status: true,
          userRoles: { select: { role: { select: { id: true, name: true, type: true } } } },
        },
      },
    },
  });

  return assignments.map(({ user, createdAt }) => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    employeeCode: user.employeeCode,
    status: user.status,
    assignedAt: createdAt,
    roles: user.userRoles.map(({ role }) => role),
  }));
}

export function listPermissions() {
  return permissionCatalogue();
}

type RoleReader = { role: Pick<typeof prisma.role, 'findFirst'> };

export async function getRole(organizationId: string, id: string, db: RoleReader = prisma) {
  const role = await db.role.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      rolePermissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { userRoles: true } },
    },
  });
  if (!role) throw notFound('Role');
  return role;
}

export async function createRole(
  auth: AuthContext,
  input: { name: string; description?: string; permissionKeys: string[]; status?: RoleStatus },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const permissionKeys = withAlwaysGranted(input.permissionKeys);
    assertCanGrant(auth, permissionKeys);

    // The unique constraint spans soft-deleted rows, so a name that was used by
    // a deleted role is reported clearly instead of surfacing a raw conflict.
    const existing = await tx.role.findFirst({
      where: { organizationId: auth.organizationId, name: input.name },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw conflict(`A role named "${input.name}" already exists`, [
        { field: 'name', message: 'Role names must be unique within the studio' },
      ]);
    }

    const permissions = await resolvePermissions(permissionKeys);

    const permissionRows = permissions.map((p) => ({ permissionId: p.id }));
    const role = existing
      ? await tx.role.update({
          // Reuse the soft-deleted row so the unique name is not blocked.
          where: { id: existing.id },
          data: {
            description: input.description,
            type: RoleType.CUSTOM,
            status: input.status ?? RoleStatus.ACTIVE,
            deletedAt: null,
            deletedBy: null,
            rolePermissions: { deleteMany: {}, createMany: { data: permissionRows } },
          },
          include: {
            rolePermissions: { select: { permission: { select: { key: true } } } },
            _count: { select: { userRoles: true } },
          },
        })
      : await tx.role.create({
          data: {
            organizationId: auth.organizationId,
            name: input.name,
            description: input.description,
            type: RoleType.CUSTOM,
            status: input.status ?? RoleStatus.ACTIVE,
            rolePermissions: { createMany: { data: permissionRows } },
          },
          include: {
            rolePermissions: { select: { permission: { select: { key: true } } } },
            _count: { select: { userRoles: true } },
          },
        });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Role',
      entityId: role.id,
      summary: `Role ${role.name} created with ${permissions.length} permission(s)`,
      newData: { name: role.name, permissions: permissionKeys },
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
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) throw notFound('Role');

    let nextKeys = withAlwaysGranted(permissionKeys);
    if (role.type === RoleType.SYSTEM && role.name === 'ADMIN') {
      const current = role.rolePermissions.map((rp) => rp.permission.key);
      const keep = current.filter((key) => !key.startsWith('DASHBOARD_') || key === 'DASHBOARD_VIEW');
      const dashboardNext = nextKeys.filter((key) => key.startsWith('DASHBOARD_'));
      nextKeys = withAlwaysGranted([...keep, ...dashboardNext, 'DASHBOARD_VIEW']);
    }

    const permissions = await resolvePermissions(nextKeys);
    // Only newly added keys need the escalation check: a role may already hold
    // more than the editor does, and that set is preserved untouched.
    const currentKeys = role.rolePermissions.map((rp) => rp.permission.key);
    assertCanGrant(auth, nextKeys.filter((key) => !currentKeys.includes(key)));

    const before = role.rolePermissions.map((rp) => rp.permission.key).sort();
    const after = [...nextKeys].sort();
    const added = after.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !after.includes(k));

    // Write only the diff. Replacing all ~100 rows on every save cost two full
    // table writes even when a single checkbox moved.
    const byKey = new Map(permissions.map((permission) => [permission.key, permission]));
    if (removed.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { roleId: id, permission: { key: { in: removed } } },
      });
    }
    if (added.length > 0) {
      await tx.rolePermission.createMany({
        data: added.map((key) => ({ roleId: id, permissionId: byKey.get(key)!.id })),
        skipDuplicates: true,
      });
    }

    await recordAudit(tx, ctx, {
      action: 'PERMISSION_CHANGED',
      entityType: 'Role',
      entityId: id,
      summary: `Role ${role.name}: +${added.length} / -${removed.length} permissions`,
      oldData: { permissions: before },
      newData: { permissions: after, added, removed },
    });

    // The resulting set is already known, so the response is assembled here
    // rather than paying another round trip to read back what we just wrote.
    return {
      ...role,
      updatedAt: new Date(),
      rolePermissions: after.map((key) => ({ permission: { key } })),
    };
  });
}

export async function updateRole(
  auth: AuthContext,
  id: string,
  input: { name?: string; description?: string; status?: RoleStatus },
  ctx: AuditRequestContext,
) {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
  });
  if (!role) throw notFound('Role');
  if (role.type === RoleType.SYSTEM && input.name && input.name !== role.name) {
    throw conflict('A system role cannot be renamed');
  }
  // Suspending a system role would lock every administrator out of the studio.
  if (role.type === RoleType.SYSTEM && input.status && input.status !== role.status) {
    throw conflict('A system role cannot be deactivated');
  }

  const updated = await prisma.role.update({ where: { id }, data: input });
  const statusChanged = input.status !== undefined && input.status !== role.status;
  await recordAudit(prisma, ctx, {
    action: statusChanged ? 'ROLE_CHANGED' : 'UPDATE',
    entityType: 'Role',
    entityId: id,
    summary: statusChanged
      ? `Role ${role.name} set to ${input.status}`
      : `Role ${role.name} updated`,
    oldData: { name: role.name, description: role.description, status: role.status },
    newData: { name: updated.name, description: updated.description, status: updated.status },
  });
  return updated;
}

export async function deleteRole(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
    include: {
      _count: { select: { userRoles: true } },
      userRoles: { select: { user: { select: { fullName: true } } }, take: 5 },
    },
  });
  if (!role) throw notFound('Role');
  if (role.type === RoleType.SYSTEM) throw conflict('A system role cannot be deleted');
  if (role._count.userRoles > 0) {
    // Blocking beats silently unassigning: a user left with no role would lose
    // every permission on their next request.
    const names = role.userRoles.map((ur) => ur.user.fullName);
    const more = role._count.userRoles - names.length;
    throw conflict(
      `This role is still assigned to ${role._count.userRoles} user(s). ` +
        `Reassign ${names.join(', ')}${more > 0 ? ` and ${more} other(s)` : ''} first.`,
      [{ field: 'roleId', message: 'Reassign the affected users before deleting this role' }],
    );
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

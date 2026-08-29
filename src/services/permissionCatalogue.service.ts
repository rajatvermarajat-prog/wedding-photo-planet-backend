import { RoleType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ALWAYS_GRANTED_KEYS, PERMISSIONS, SYSTEM_ROLES, permissionsForSystemRole } from '../types/permissions';

async function grantAlwaysOnPermissions() {
  const perms = await prisma.permission.findMany({
    where: { key: { in: [...ALWAYS_GRANTED_KEYS] } },
    select: { id: true },
  });
  if (!perms.length) return;
  const roles = await prisma.role.findMany({ where: { deletedAt: null }, select: { id: true } });
  if (!roles.length) return;
  await prisma.rolePermission.createMany({
    data: roles.flatMap((role) => perms.map((permission) => ({ roleId: role.id, permissionId: permission.id }))),
    skipDuplicates: true,
  });
}

/** Upserts the in-code catalogue and grants newly added keys to system roles. */
export async function syncPermissionCatalogue(): Promise<number> {
  const existing = await prisma.permission.findMany({ select: { key: true } });
  const existingKeys = new Set(existing.map((row) => row.key));
  const created: string[] = [];

  for (const permission of PERMISSIONS) {
    if (existingKeys.has(permission.key)) {
      await prisma.permission.update({
        where: { key: permission.key },
        data: {
          module: permission.module,
          label: permission.label,
          isSensitive: permission.isSensitive ?? false,
        },
      });
      continue;
    }
    await prisma.permission.create({
      data: {
        key: permission.key,
        module: permission.module,
        label: permission.label,
        isSensitive: permission.isSensitive ?? false,
      },
    });
    created.push(permission.key);
  }

  await grantAlwaysOnPermissions();

  if (!created.length) return 0;

  const rows = await prisma.permission.findMany({
    where: { key: { in: created } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(rows.map((row) => [row.key, row.id]));
  const orgs = await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    for (const roleName of SYSTEM_ROLES) {
      const role = await prisma.role.findFirst({
        where: { organizationId: org.id, name: roleName, type: RoleType.SYSTEM, deletedAt: null },
        select: { id: true },
      });
      if (!role) continue;
      const allowed = new Set(permissionsForSystemRole(roleName));
      const permissionIds = created
        .filter((key) => allowed.has(key))
        .map((key) => idByKey.get(key))
        .filter((id): id is string => Boolean(id));
      if (!permissionIds.length) continue;
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  return created.length;
}

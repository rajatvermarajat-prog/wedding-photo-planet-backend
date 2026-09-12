import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AuthContext } from '../types';

export type PersonalSheetData = {
  columns: Array<{ id: string; label: string }>;
  rows: Array<{ id: string; cells: Record<string, string | number> }>;
};

const defaultSheet: PersonalSheetData = {
  columns: [
    { id: 'column-a', label: 'A' },
    { id: 'column-b', label: 'B' },
    { id: 'column-c', label: 'C' },
  ],
  rows: Array.from({ length: 5 }, (_, index) => ({ id: `row-${index + 1}`, cells: {} })),
};

function ownWhere(auth: AuthContext) {
  return { organizationId: auth.organizationId, userId: auth.userId };
}

export async function getPersonalSheet(auth: AuthContext) {
  return prisma.personalSheet.upsert({
    where: { organizationId_userId: ownWhere(auth) },
    create: { ...ownWhere(auth), data: defaultSheet as Prisma.InputJsonValue },
    update: {},
  });
}

export function savePersonalSheet(auth: AuthContext, data: PersonalSheetData) {
  return prisma.personalSheet.upsert({
    where: { organizationId_userId: ownWhere(auth) },
    create: { ...ownWhere(auth), data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });
}

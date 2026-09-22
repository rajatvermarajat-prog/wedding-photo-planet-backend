import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AuthContext } from '../types';

export type SheetCellValue = string | number;

export interface PersonalSheetData {
  columns: Array<{ id: string; label: string }>;
  rows: Array<{ id: string; cells: Record<string, SheetCellValue> }>;
}

const DEFAULT_COLUMNS = 5;
const DEFAULT_ROWS = 12;

/** Spreadsheet-style column names: A, B, ... Z, AA, AB, ... */
function columnLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

/**
 * The grid editor cannot render an empty sheet — it always needs at least one
 * column and one row to draw — so a user opening it for the first time is given
 * a blank grid rather than nothing.
 */
function defaultSheet(): PersonalSheetData {
  return {
    columns: Array.from({ length: DEFAULT_COLUMNS }, (_, index) => ({
      id: `column-${randomUUID()}`,
      label: columnLabel(index),
    })),
    rows: Array.from({ length: DEFAULT_ROWS }, () => ({ id: `row-${randomUUID()}`, cells: {} })),
  };
}

const SELECT = { id: true, data: true, updatedAt: true } as const;

/**
 * A personal sheet is private to its owner: every query is scoped by both the
 * user and the organization, and no permission grants access to anyone else's.
 */
export async function getPersonalSheet(auth: AuthContext) {
  const existing = await prisma.personalSheet.findFirst({
    where: { userId: auth.userId, organizationId: auth.organizationId },
    select: SELECT,
  });
  if (existing) return existing;

  // First open. Created lazily so a sheet row only exists for users who use it.
  return prisma.personalSheet.create({
    data: {
      organizationId: auth.organizationId,
      userId: auth.userId,
      data: defaultSheet() as unknown as Prisma.InputJsonValue,
    },
    select: SELECT,
  });
}

export async function savePersonalSheet(auth: AuthContext, sheet: PersonalSheetData) {
  const data = sheet as unknown as Prisma.InputJsonValue;
  return prisma.personalSheet.upsert({
    where: { userId: auth.userId },
    create: { organizationId: auth.organizationId, userId: auth.userId, data },
    update: { organizationId: auth.organizationId, data },
    select: SELECT,
  });
}

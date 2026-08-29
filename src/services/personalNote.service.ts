import { prisma } from '../config/prisma';
import { notFound } from '../utils/errors';
import { AuthContext } from '../types';

function ownWhere(auth: AuthContext) {
  return { organizationId: auth.organizationId, userId: auth.userId, deletedAt: null };
}

export function listPersonalNotes(auth: AuthContext) {
  return prisma.personalNote.findMany({
    where: ownWhere(auth),
    orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }],
  });
}

export async function createPersonalNote(
  auth: AuthContext,
  input: { title?: string; content?: string },
) {
  const count = await prisma.personalNote.count({ where: ownWhere(auth) });
  return prisma.personalNote.create({
    data: {
      organizationId: auth.organizationId,
      userId: auth.userId,
      title: input.title?.trim() || 'New Private Note',
      content: input.content ?? '',
      sortOrder: count,
    },
  });
}

async function ownNote(auth: AuthContext, id: string) {
  const note = await prisma.personalNote.findFirst({ where: { id, ...ownWhere(auth) } });
  if (!note) throw notFound('Private note');
  return note;
}

export async function updatePersonalNote(
  auth: AuthContext,
  id: string,
  input: { title?: string; content?: string; pinned?: boolean; sortOrder?: number },
) {
  await ownNote(auth, id);
  return prisma.personalNote.update({
    where: { id },
    data: {
      title: input.title,
      content: input.content,
      pinned: input.pinned,
      sortOrder: input.sortOrder,
    },
  });
}

export async function reorderPersonalNotes(auth: AuthContext, ids: string[]) {
  const notes = await prisma.personalNote.findMany({
    where: { ...ownWhere(auth), id: { in: ids } },
    select: { id: true },
  });
  const owned = new Set(notes.map((note) => note.id));
  await prisma.$transaction(
    ids.filter((id) => owned.has(id)).map((id, index) =>
      prisma.personalNote.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
  return listPersonalNotes(auth);
}

export async function deletePersonalNote(auth: AuthContext, id: string) {
  await ownNote(auth, id);
  await prisma.personalNote.update({ where: { id }, data: { deletedAt: new Date() } });
}

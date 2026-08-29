import { TaskPriority } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, paginate, searchFilter } from '../repositories/base.repository';
import { notFound } from '../utils/errors';
import { AuthContext } from '../types';

export interface PersonalTodoListQuery {
  page?: number;
  limit?: number;
  search?: string;
  completed?: boolean;
}

export interface CreatePersonalTodoInput {
  title: string;
  priority?: TaskPriority;
  dueDate?: Date;
  category?: string;
}

export interface UpdatePersonalTodoInput {
  title?: string;
  priority?: TaskPriority;
  dueDate?: Date | null;
  completed?: boolean;
  category?: string | null;
}

function ownWhere(auth: AuthContext) {
  return { organizationId: auth.organizationId, userId: auth.userId, deletedAt: null };
}

export function listPersonalTodos(auth: AuthContext, query: PersonalTodoListQuery) {
  return paginate(prisma.personalTodo, {
    where: andWhere(ownWhere(auth), query.completed === undefined ? undefined : { completed: query.completed }, searchFilter(query.search, ['title'])),
    orderBy: [{ completed: 'asc' }, { createdAt: 'desc' }],
    page: query.page,
    limit: query.limit,
  });
}

export function createPersonalTodo(auth: AuthContext, input: CreatePersonalTodoInput) {
  return prisma.personalTodo.create({
    data: {
      organizationId: auth.organizationId,
      userId: auth.userId,
      title: input.title,
      priority: input.priority ?? 'MEDIUM',
      dueDate: input.dueDate,
      category: input.category,
    },
  });
}

async function ownTodo(auth: AuthContext, id: string) {
  const todo = await prisma.personalTodo.findFirst({ where: { id, ...ownWhere(auth) } });
  if (!todo) throw notFound('Personal to-do');
  return todo;
}

export async function updatePersonalTodo(auth: AuthContext, id: string, input: UpdatePersonalTodoInput) {
  await ownTodo(auth, id);
  const completedAt = input.completed === undefined ? undefined : input.completed ? new Date() : null;
  return prisma.personalTodo.update({
    where: { id },
    data: {
      title: input.title,
      priority: input.priority,
      dueDate: input.dueDate,
      completed: input.completed,
      completedAt,
      category: input.category,
    },
  });
}

export async function deletePersonalTodo(auth: AuthContext, id: string) {
  await ownTodo(auth, id);
  await prisma.personalTodo.update({ where: { id }, data: { deletedAt: new Date() } });
}

export function clearCompletedPersonalTodos(auth: AuthContext) {
  return prisma.personalTodo.updateMany({
    where: { ...ownWhere(auth), completed: true },
    data: { deletedAt: new Date() },
  });
}

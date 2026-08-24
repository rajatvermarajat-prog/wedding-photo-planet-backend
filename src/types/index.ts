import { Request } from 'express';

/** Everything the request handler chain knows about the caller. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  branchId: string | null;
  sessionId: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
    }
    interface Locals {
      requestId?: string;
    }
  }
}

/** A request that has passed `requireAuth`, so `auth` is guaranteed present. */
export interface AuthedRequest extends Request {
  auth: AuthContext;
}

export interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  from?: string;
  to?: string;
}

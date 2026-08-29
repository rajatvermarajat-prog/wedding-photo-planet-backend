import { Router } from 'express';
import * as controller from '../controllers/crm.controller';
import { validate } from '../middleware/validate';
import { requireAnyPermission, requirePermission } from '../middleware/rbac';
import { idParam } from '../validators/common.validator';
import {
  clientListQuery,
  clientNoteSchema,
  convertLeadSchema,
  createClientSchema,
  createLeadSchema,
  followUpSchema,
  leadListQuery,
  leadSourceSchema,
  updateClientSchema,
  updateLeadSchema,
} from '../validators/crm.validator';

export const clientRouter = Router();

clientRouter.get(
  '/',
  requireAnyPermission('CLIENT_VIEW', 'CLIENT_CREATE', 'PROJECT_CREATE'),
  validate({ query: clientListQuery }),
  controller.listClients,
);
clientRouter.post(
  '/',
  requireAnyPermission('CLIENT_CREATE', 'PROJECT_CREATE'),
  validate({ body: createClientSchema }),
  controller.createClient,
);
clientRouter.get(
  '/:id',
  requirePermission('CLIENT_VIEW'),
  validate({ params: idParam }),
  controller.getClient,
);
clientRouter.patch(
  '/:id',
  requirePermission('CLIENT_UPDATE'),
  validate({ params: idParam, body: updateClientSchema }),
  controller.updateClient,
);
clientRouter.delete(
  '/:id',
  requirePermission('CLIENT_DELETE'),
  validate({ params: idParam }),
  controller.deleteClient,
);
clientRouter.post(
  '/:id/notes',
  requirePermission('CLIENT_UPDATE'),
  validate({ params: idParam, body: clientNoteSchema }),
  controller.addClientNote,
);

export const leadRouter = Router();

leadRouter.get(
  '/',
  requirePermission('LEAD_VIEW'),
  validate({ query: leadListQuery }),
  controller.listLeads,
);
leadRouter.post(
  '/',
  requirePermission('LEAD_CREATE'),
  validate({ body: createLeadSchema }),
  controller.createLead,
);
leadRouter.get('/sources', requirePermission('LEAD_VIEW'), controller.listLeadSources);
leadRouter.post(
  '/sources',
  requirePermission('LEAD_CREATE'),
  validate({ body: leadSourceSchema }),
  controller.createLeadSource,
);
leadRouter.get(
  '/:id',
  requirePermission('LEAD_VIEW'),
  validate({ params: idParam }),
  controller.getLead,
);
leadRouter.patch(
  '/:id',
  requirePermission('LEAD_UPDATE'),
  validate({ params: idParam, body: updateLeadSchema }),
  controller.updateLead,
);
leadRouter.delete(
  '/:id',
  requirePermission('LEAD_DELETE'),
  validate({ params: idParam }),
  controller.deleteLead,
);
leadRouter.post(
  '/:id/follow-ups',
  requirePermission('LEAD_UPDATE'),
  validate({ params: idParam, body: followUpSchema }),
  controller.addFollowUp,
);
leadRouter.post(
  '/:id/convert',
  requirePermission('LEAD_CONVERT'),
  validate({ params: idParam, body: convertLeadSchema }),
  controller.convertLead,
);

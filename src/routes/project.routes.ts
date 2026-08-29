import { Router } from 'express';
import * as controller from '../controllers/project.controller';
import { validate } from '../middleware/validate';
import { requireAnyPermission, requirePermission } from '../middleware/rbac';
import { idParam } from '../validators/common.validator';
import {
  assignCrewSchema,
  assignmentParams,
  createEventSchema,
  createProjectSchema,
  createShootSchema,
  eventListQuery,
  eventTypeSchema,
  projectListQuery,
  projectStatusSchema,
  shootListQuery,
  updateAssignmentSchema,
  updateEventSchema,
  updateProjectSchema,
  updateShootSchema,
} from '../validators/project.validator';

export const projectRouter = Router();

projectRouter.get(
  '/',
  requireAnyPermission('PROJECT_VIEW', 'DATA_MANAGEMENT_VIEW'),
  validate({ query: projectListQuery }),
  controller.list,
);
projectRouter.post(
  '/',
  requirePermission('PROJECT_CREATE'),
  validate({ body: createProjectSchema }),
  controller.create,
);
projectRouter.get(
  '/:id',
  requireAnyPermission('PROJECT_VIEW', 'DATA_MANAGEMENT_VIEW'),
  validate({ params: idParam }),
  controller.get,
);
projectRouter.patch(
  '/:id',
  requirePermission('PROJECT_UPDATE'),
  validate({ params: idParam, body: updateProjectSchema }),
  controller.update,
);
projectRouter.patch(
  '/:id/status',
  requirePermission('PROJECT_STATUS_CHANGE'),
  validate({ params: idParam, body: projectStatusSchema }),
  controller.changeStatus,
);
projectRouter.get(
  '/:id/status-history',
  requirePermission('PROJECT_VIEW'),
  validate({ params: idParam }),
  controller.statusHistory,
);
projectRouter.delete(
  '/:id',
  requirePermission('PROJECT_DELETE'),
  validate({ params: idParam }),
  controller.remove,
);

export const eventRouter = Router();

eventRouter.get(
  '/',
  requirePermission('EVENT_VIEW'),
  validate({ query: eventListQuery }),
  controller.listEvents,
);
eventRouter.post(
  '/',
  requirePermission('EVENT_CREATE'),
  validate({ body: createEventSchema }),
  controller.createEvent,
);
eventRouter.get('/types', requirePermission('EVENT_VIEW'), controller.listEventTypes);
eventRouter.post(
  '/types',
  requirePermission('EVENT_CREATE'),
  validate({ body: eventTypeSchema }),
  controller.createEventType,
);
eventRouter.get(
  '/:id',
  requirePermission('EVENT_VIEW'),
  validate({ params: idParam }),
  controller.getEvent,
);
eventRouter.patch(
  '/:id',
  requirePermission('EVENT_UPDATE'),
  validate({ params: idParam, body: updateEventSchema }),
  controller.updateEvent,
);
eventRouter.delete(
  '/:id',
  requirePermission('EVENT_DELETE'),
  validate({ params: idParam }),
  controller.removeEvent,
);

export const shootRouter = Router();

shootRouter.get(
  '/',
  requireAnyPermission('SHOOT_VIEW', 'DATA_MANAGEMENT_VIEW'),
  validate({ query: shootListQuery }),
  controller.listShoots,
);
shootRouter.post(
  '/',
  requirePermission('SHOOT_CREATE'),
  validate({ body: createShootSchema }),
  controller.createShoot,
);
shootRouter.get(
  '/:id',
  requireAnyPermission('SHOOT_VIEW', 'DATA_MANAGEMENT_VIEW'),
  validate({ params: idParam }),
  controller.getShoot,
);
shootRouter.patch(
  '/:id',
  requireAnyPermission('SHOOT_UPDATE', 'DATA_MANAGEMENT_VIEW'),
  validate({ params: idParam, body: updateShootSchema }),
  controller.updateShoot,
);
shootRouter.delete(
  '/:id',
  requirePermission('SHOOT_DELETE'),
  validate({ params: idParam }),
  controller.removeShoot,
);
shootRouter.post(
  '/:id/assignments',
  requirePermission('SHOOT_ASSIGN'),
  validate({ params: idParam, body: assignCrewSchema }),
  controller.assignCrew,
);
shootRouter.patch(
  '/:id/assignments/:assignmentId',
  requireAnyPermission('SHOOT_ASSIGN', 'DATA_MANAGEMENT_VIEW'),
  validate({ params: assignmentParams, body: updateAssignmentSchema }),
  controller.updateAssignment,
);
shootRouter.delete(
  '/:id/assignments/:assignmentId',
  requirePermission('SHOOT_ASSIGN'),
  validate({ params: assignmentParams }),
  controller.removeAssignment,
);

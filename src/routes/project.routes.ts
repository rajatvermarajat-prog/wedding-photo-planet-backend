import { Router } from 'express';
import * as controller from '../controllers/project.controller';
import * as opsController from '../controllers/ops.controller';
import { validate } from '../middleware/validate';
import { requireAnyPermission, requirePermission } from '../middleware/rbac';
import { idParam } from '../validators/common.validator';
import {
  assignCrewSchema,
  assignmentParams,
  paymentMilestoneParams,
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
  createProjectClientAssetSchema,
  projectClientAssetParams,
  projectClientAssetUploadIntentSchema,
  updateProjectClientAssetSchema,
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
projectRouter.get('/:id/client-assets', requireAnyPermission('PROJECT_VIEW', 'DATA_MANAGEMENT_VIEW'), validate({ params: idParam }), controller.listClientAssets);
projectRouter.post('/:id/client-assets/upload-intent', requirePermission('PROJECT_UPDATE'), validate({ params: idParam, body: projectClientAssetUploadIntentSchema }), controller.createClientAssetUploadIntent);
projectRouter.post('/:id/client-assets', requirePermission('PROJECT_UPDATE'), validate({ params: idParam, body: createProjectClientAssetSchema }), controller.createClientAsset);
projectRouter.get('/:id/client-assets/:assetId/download-url', requireAnyPermission('PROJECT_VIEW', 'DATA_MANAGEMENT_VIEW'), validate({ params: projectClientAssetParams }), controller.clientAssetDownloadUrl);
projectRouter.patch('/:id/client-assets/:assetId', requirePermission('PROJECT_UPDATE'), validate({ params: projectClientAssetParams, body: updateProjectClientAssetSchema }), controller.updateClientAsset);
projectRouter.delete('/:id/client-assets/:assetId', requirePermission('PROJECT_UPDATE'), validate({ params: projectClientAssetParams }), controller.deleteClientAsset);
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
projectRouter.patch(
  '/:id/data-backup',
  requirePermission('PROJECT_UPDATE'),
  validate({ params: idParam }),
  controller.updateDataBackup,
);
projectRouter.patch(
  '/:id/deliveries',
  requirePermission('PROJECT_UPDATE'),
  validate({ params: idParam }),
  controller.updateDeliveries,
);
projectRouter.get(
  '/:id/shoots',
  requireAnyPermission('SHOOT_VIEW', 'DATA_MANAGEMENT_VIEW'),
  validate({ params: idParam }),
  (req, res, next) => {
    req.query = { ...req.query, projectId: req.params.id };
    return controller.listShoots(req, res, next);
  },
);
projectRouter.get(
  '/:id/tasks',
  requirePermission('TASK_VIEW'),
  validate({ params: idParam }),
  (req, res, next) => {
    req.query = { ...req.query, projectId: req.params.id };
    return opsController.listTasks(req, res, next);
  },
);
projectRouter.get(
  '/:id/payment-milestones',
  requirePermission('PAYMENT_VIEW'),
  validate({ params: idParam }),
  controller.listPaymentMilestones,
);
projectRouter.get(
  '/:id/payments',
  requirePermission('PAYMENT_VIEW'),
  validate({ params: idParam }),
  (req, res, next) => {
    req.query = { ...req.query, projectId: req.params.id };
    return controller.listPaymentMilestones(req, res, next);
  },
);

projectRouter.delete(
  '/:id/payment-milestones/:milestoneId',
  requirePermission('PROJECT_UPDATE'),
  validate({ params: paymentMilestoneParams }),
  controller.removePaymentMilestone,
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

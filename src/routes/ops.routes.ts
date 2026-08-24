import { Router } from 'express';
import * as controller from '../controllers/ops.controller';
import { validate } from '../middleware/validate';
import { requirePermission } from '../middleware/rbac';
import { idempotent } from '../middleware/idempotency';
import { idParam } from '../validators/common.validator';
import {
  attendanceListQuery,
  createDeliverySchema,
  createFreelancerSchema,
  createTaskSchema,
  deliveryListQuery,
  deliveryStatusSchema,
  freelancerListQuery,
  freelancerPayoutSchema,
  leaveListQuery,
  markAttendanceSchema,
  reassignTaskSchema,
  requestLeaveSchema,
  reviewLeaveSchema,
  taskListQuery,
  taskStatusSchema,
  updateDeliverySchema,
  updateFreelancerSchema,
  updateTaskSchema,
} from '../validators/ops.validator';

export const taskRouter = Router();

taskRouter.get(
  '/',
  requirePermission('TASK_VIEW'),
  validate({ query: taskListQuery }),
  controller.listTasks,
);
taskRouter.post(
  '/',
  requirePermission('TASK_CREATE'),
  validate({ body: createTaskSchema }),
  controller.createTask,
);
taskRouter.get(
  '/:id',
  requirePermission('TASK_VIEW'),
  validate({ params: idParam }),
  controller.getTask,
);
taskRouter.patch(
  '/:id',
  requirePermission('TASK_UPDATE'),
  validate({ params: idParam, body: updateTaskSchema }),
  controller.updateTask,
);
taskRouter.patch(
  '/:id/status',
  requirePermission('TASK_UPDATE'),
  validate({ params: idParam, body: taskStatusSchema }),
  controller.changeTaskStatus,
);
taskRouter.post(
  '/:id/reassign',
  requirePermission('TASK_ASSIGN'),
  validate({ params: idParam, body: reassignTaskSchema }),
  controller.reassignTask,
);
taskRouter.delete(
  '/:id',
  requirePermission('TASK_DELETE'),
  validate({ params: idParam }),
  controller.removeTask,
);

export const deliveryRouter = Router();

deliveryRouter.get(
  '/',
  requirePermission('DELIVERY_VIEW'),
  validate({ query: deliveryListQuery }),
  controller.listDeliveries,
);
deliveryRouter.post(
  '/',
  requirePermission('DELIVERY_CREATE'),
  validate({ body: createDeliverySchema }),
  controller.createDelivery,
);
deliveryRouter.get(
  '/:id',
  requirePermission('DELIVERY_VIEW'),
  validate({ params: idParam }),
  controller.getDelivery,
);
deliveryRouter.patch(
  '/:id',
  requirePermission('DELIVERY_UPDATE'),
  validate({ params: idParam, body: updateDeliverySchema }),
  controller.updateDelivery,
);
deliveryRouter.patch(
  '/:id/status',
  requirePermission('DELIVERY_UPDATE'),
  validate({ params: idParam, body: deliveryStatusSchema }),
  controller.changeDeliveryStatus,
);
deliveryRouter.delete(
  '/:id',
  requirePermission('DELIVERY_DELETE'),
  validate({ params: idParam }),
  controller.removeDelivery,
);

export const freelancerRouter = Router();

freelancerRouter.get(
  '/',
  requirePermission('FREELANCER_VIEW'),
  validate({ query: freelancerListQuery }),
  controller.listFreelancers,
);
freelancerRouter.post(
  '/',
  requirePermission('FREELANCER_CREATE'),
  validate({ body: createFreelancerSchema }),
  controller.createFreelancer,
);
freelancerRouter.get(
  '/:id',
  requirePermission('FREELANCER_VIEW'),
  validate({ params: idParam }),
  controller.getFreelancer,
);
freelancerRouter.patch(
  '/:id',
  requirePermission('FREELANCER_UPDATE'),
  validate({ params: idParam, body: updateFreelancerSchema }),
  controller.updateFreelancer,
);
freelancerRouter.delete(
  '/:id',
  requirePermission('FREELANCER_DELETE'),
  validate({ params: idParam }),
  controller.removeFreelancer,
);
freelancerRouter.get(
  '/:id/ledger',
  requirePermission('FREELANCER_VIEW'),
  validate({ params: idParam }),
  controller.freelancerLedger,
);
freelancerRouter.post(
  '/:id/payouts',
  requirePermission('FREELANCER_PAY'),
  validate({ params: idParam, body: freelancerPayoutSchema }),
  idempotent({ required: true }),
  controller.recordPayout,
);

export const attendanceRouter = Router();

attendanceRouter.get(
  '/',
  requirePermission('ATTENDANCE_VIEW'),
  validate({ query: attendanceListQuery }),
  controller.listAttendance,
);
attendanceRouter.post(
  '/',
  requirePermission('ATTENDANCE_MARK'),
  validate({ body: markAttendanceSchema }),
  controller.markAttendance,
);
attendanceRouter.get('/summary', requirePermission('ATTENDANCE_VIEW'), controller.attendanceSummary);

attendanceRouter.get(
  '/leave',
  requirePermission('LEAVE_VIEW'),
  validate({ query: leaveListQuery }),
  controller.listLeave,
);
attendanceRouter.post(
  '/leave',
  requirePermission('LEAVE_REQUEST'),
  validate({ body: requestLeaveSchema }),
  controller.requestLeave,
);
attendanceRouter.post(
  '/leave/:id/review',
  requirePermission('LEAVE_APPROVE'),
  validate({ params: idParam, body: reviewLeaveSchema }),
  controller.reviewLeave,
);

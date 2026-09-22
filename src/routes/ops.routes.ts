import { Router } from 'express';
import * as controller from '../controllers/ops.controller';
import { validate } from '../middleware/validate';
import { requireAnyPermission, requirePermission } from '../middleware/rbac';
import { idempotent } from '../middleware/idempotency';
import { idParam } from '../validators/common.validator';
import {
  attendanceListQuery,
  availabilityListQuery,
  createDeliverySchema,
  createFreelancerApplicationSchema,
  createFreelancerConnectionSchema,
  connectFreelancerConnectionSchema,
  createFreelancerSchema,
  createFreelancerPlanSchema,
  createFreelancerSubscriptionSchema,
  createPortfolioItemSchema,
  createTaskSchema,
  deliveryListQuery,
  employeePerformanceParams,
  deliveryStatusSchema,
  freelancerApplicationListQuery,
  freelancerConnectionListQuery,
  freelancerListQuery,
  freelancerSearchQuery,
  freelancerPlanListQuery,
  freelancerPortfolioItemParams,
  freelancerPayoutSchema,
  freelancerSubscriptionParams,
  leaveListQuery,
  markAttendanceSchema,
  monthlyAttendanceSummaryQuery,
  personalTodoListQuery,
  createPersonalTodoSchema,
  updatePersonalTodoSchema,
  createPersonalNoteSchema,
  updatePersonalNoteSchema,
  reorderPersonalNotesSchema,
  personalSheetSchema,
  reassignTaskSchema,
  requestLeaveSchema,
  reviewLeaveSchema,
  reviewFreelancerApplicationSchema,
  taskListQuery,
  taskStatusSchema,
  updateDeliverySchema,
  updateFreelancerConnectionSchema,
  updateFreelancerSchema,
  updateFreelancerPlanSchema,
  updateFreelancerSubscriptionSchema,
  updatePortfolioItemSchema,
  updateTaskSchema,
  upsertAvailabilitySchema,
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
  '/plans',
  requirePermission('FREELANCER_VIEW'),
  validate({ query: freelancerPlanListQuery }),
  controller.listFreelancerPlans,
);
freelancerRouter.post(
  '/plans',
  requirePermission('FREELANCER_PLAN_MANAGE'),
  validate({ body: createFreelancerPlanSchema }),
  controller.createFreelancerPlan,
);
freelancerRouter.patch(
  '/plans/:id',
  requirePermission('FREELANCER_PLAN_MANAGE'),
  validate({ params: idParam, body: updateFreelancerPlanSchema }),
  controller.updateFreelancerPlan,
);
freelancerRouter.get(
  '/applications',
  requirePermission('FREELANCER_VIEW'),
  validate({ query: freelancerApplicationListQuery }),
  controller.listFreelancerApplications,
);
freelancerRouter.post(
  '/applications',
  requirePermission('FREELANCER_APPLICATION_REVIEW'),
  validate({ body: createFreelancerApplicationSchema }),
  controller.createFreelancerApplication,
);
freelancerRouter.post(
  '/applications/:id/review',
  requirePermission('FREELANCER_APPLICATION_REVIEW'),
  validate({ params: idParam, body: reviewFreelancerApplicationSchema }),
  controller.reviewFreelancerApplication,
);
freelancerRouter.get(
  '/connections',
  requirePermission('FREELANCER_VIEW'),
  validate({ query: freelancerConnectionListQuery }),
  controller.listFreelancerConnections,
);
freelancerRouter.post(
  '/connections',
  requirePermission('FREELANCER_CONNECTION_MANAGE'),
  validate({ body: createFreelancerConnectionSchema }),
  controller.createFreelancerConnection,
);
freelancerRouter.patch(
  '/connections/:id',
  requirePermission('FREELANCER_CONNECTION_MANAGE'),
  validate({ params: idParam, body: updateFreelancerConnectionSchema }),
  controller.updateFreelancerConnection,
);
freelancerRouter.post(
  '/connections/:id/connect',
  requirePermission('FREELANCER_CONNECTION_MANAGE', 'SHOOT_ASSIGN'),
  validate({ params: idParam, body: connectFreelancerConnectionSchema }),
  controller.connectFreelancerConnection,
);
freelancerRouter.get(
  '/search',
  requirePermission('FREELANCER_VIEW'),
  validate({ query: freelancerSearchQuery }),
  controller.searchFreelancers,
);
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
freelancerRouter.get(
  '/:id/subscriptions',
  requirePermission('FREELANCER_VIEW'),
  validate({ params: idParam }),
  controller.listFreelancerSubscriptions,
);
freelancerRouter.post(
  '/:id/subscriptions',
  requirePermission('FREELANCER_PLAN_MANAGE'),
  validate({ params: idParam, body: createFreelancerSubscriptionSchema }),
  controller.createFreelancerSubscription,
);
freelancerRouter.patch(
  '/:id/subscriptions/:subscriptionId',
  requirePermission('FREELANCER_PLAN_MANAGE'),
  validate({ params: freelancerSubscriptionParams, body: updateFreelancerSubscriptionSchema }),
  controller.updateFreelancerSubscription,
);
freelancerRouter.get(
  '/:id/availability',
  requirePermission('FREELANCER_VIEW'),
  validate({ params: idParam, query: availabilityListQuery }),
  controller.listFreelancerAvailability,
);
freelancerRouter.put(
  '/:id/availability',
  requirePermission('FREELANCER_UPDATE'),
  validate({ params: idParam, body: upsertAvailabilitySchema }),
  controller.upsertFreelancerAvailability,
);
freelancerRouter.get(
  '/:id/portfolio',
  requirePermission('FREELANCER_VIEW'),
  validate({ params: idParam }),
  controller.listFreelancerPortfolio,
);
freelancerRouter.post(
  '/:id/portfolio',
  requirePermission('FREELANCER_UPDATE'),
  validate({ params: idParam, body: createPortfolioItemSchema }),
  controller.createFreelancerPortfolioItem,
);
freelancerRouter.patch(
  '/:id/portfolio/:itemId',
  requirePermission('FREELANCER_UPDATE'),
  validate({ params: freelancerPortfolioItemParams, body: updatePortfolioItemSchema }),
  controller.updateFreelancerPortfolioItem,
);

export const attendanceRouter = Router();

attendanceRouter.get(
  '/',
  requireAnyPermission('ATTENDANCE_VIEW_SELF', 'ATTENDANCE_VIEW_ALL', 'ATTENDANCE_MANAGE'),
  validate({ query: attendanceListQuery }),
  controller.listAttendance,
);
attendanceRouter.post(
  '/',
  requireAnyPermission('ATTENDANCE_MARK', 'ATTENDANCE_CREATE', 'ATTENDANCE_UPDATE', 'ATTENDANCE_MANAGE'),
  validate({ body: markAttendanceSchema }),
  controller.markAttendance,
);
attendanceRouter.get('/summary', requireAnyPermission('ATTENDANCE_VIEW_SELF', 'ATTENDANCE_VIEW_ALL', 'ATTENDANCE_MANAGE'), controller.attendanceSummary);
attendanceRouter.get('/monthly-summary', requireAnyPermission('ATTENDANCE_VIEW_SELF', 'ATTENDANCE_VIEW_ALL', 'ATTENDANCE_MANAGE'), validate({ query: monthlyAttendanceSummaryQuery }), controller.monthlyAttendanceSummary);
attendanceRouter.get('/performance/:userId', requireAnyPermission('ATTENDANCE_VIEW_SELF', 'ATTENDANCE_VIEW_ALL', 'ATTENDANCE_MANAGE'), validate({ params: employeePerformanceParams, query: monthlyAttendanceSummaryQuery }), controller.employeePerformanceReport);
attendanceRouter.get('/performance/:userId/pdf', requireAnyPermission('ATTENDANCE_VIEW_SELF', 'ATTENDANCE_VIEW_ALL', 'ATTENDANCE_MANAGE'), validate({ params: employeePerformanceParams, query: monthlyAttendanceSummaryQuery }), controller.downloadEmployeePerformanceReport);

attendanceRouter.get(
  '/leave',
  requireAnyPermission('LEAVE_VIEW_SELF', 'LEAVE_VIEW', 'LEAVE_REQUEST', 'LEAVE_APPROVE'),
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

export const personalTodoRouter = Router();

personalTodoRouter.get(
  '/',
  validate({ query: personalTodoListQuery }),
  controller.listPersonalTodos,
);
personalTodoRouter.post(
  '/',
  validate({ body: createPersonalTodoSchema }),
  controller.createPersonalTodo,
);
personalTodoRouter.delete(
  '/completed',
  controller.clearCompletedPersonalTodos,
);
personalTodoRouter.patch(
  '/:id',
  validate({ params: idParam, body: updatePersonalTodoSchema }),
  controller.updatePersonalTodo,
);
personalTodoRouter.delete(
  '/:id',
  validate({ params: idParam }),
  controller.removePersonalTodo,
);

export const personalNoteRouter = Router();

personalNoteRouter.get('/', controller.listPersonalNotes);
personalNoteRouter.post(
  '/',
  validate({ body: createPersonalNoteSchema }),
  controller.createPersonalNote,
);
personalNoteRouter.put(
  '/reorder',
  validate({ body: reorderPersonalNotesSchema }),
  controller.reorderPersonalNotes,
);
personalNoteRouter.patch(
  '/:id',
  validate({ params: idParam, body: updatePersonalNoteSchema }),
  controller.updatePersonalNote,
);
personalNoteRouter.delete(
  '/:id',
  validate({ params: idParam }),
  controller.removePersonalNote,
);

// A user's own private scratch spreadsheet. Like notes and todos, it is scoped
// to the caller and needs no permission beyond an authenticated session.
export const personalSheetRouter = Router();

personalSheetRouter.get('/', controller.getPersonalSheet);
personalSheetRouter.put(
  '/',
  validate({ body: personalSheetSchema }),
  controller.savePersonalSheet,
);

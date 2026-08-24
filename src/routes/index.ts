import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import authRoutes from './auth.routes';
import { clientRouter, leadRouter } from './crm.routes';
import { eventRouter, projectRouter, shootRouter } from './project.routes';
import { expenseRouter, invoiceRouter, paymentRouter, quotationRouter } from './finance.routes';
import { attendanceRouter, deliveryRouter, freelancerRouter, taskRouter } from './ops.routes';
import {
  auditRouter,
  branchRouter,
  dataManagementRouter,
  fileRouter,
  notificationRouter,
  organizationRouter,
  permissionRouter,
  reportRouter,
  roleRouter,
  settingRouter,
  teamRouter,
  userRouter,
} from './admin.routes';

const router = Router();

// Public (rate-limited) authentication surface.
router.use('/auth', authRoutes);

// Everything below requires a valid session; each route additionally names the
// permission it needs (§6 — authorization is never left to the frontend).
router.use(requireAuth);

router.use('/organizations', organizationRouter);
router.use('/branches', branchRouter);
router.use('/users', userRouter);
router.use('/team', teamRouter);
router.use('/roles', roleRouter);
router.use('/permissions', permissionRouter);

router.use('/leads', leadRouter);
router.use('/clients', clientRouter);
router.use('/projects', projectRouter);
router.use('/events', eventRouter);
router.use('/shoots', shootRouter);
router.use('/freelancers', freelancerRouter);
router.use('/tasks', taskRouter);
router.use('/attendance', attendanceRouter);
router.use('/deliveries', deliveryRouter);

router.use('/quotations', quotationRouter);
router.use('/invoices', invoiceRouter);
router.use('/payments', paymentRouter);
router.use('/expenses', expenseRouter);

router.use('/files', fileRouter);
router.use('/notifications', notificationRouter);
router.use('/reports', reportRouter);
router.use('/audit', auditRouter);
router.use('/settings', settingRouter);
router.use('/data-management', dataManagementRouter);

export default router;

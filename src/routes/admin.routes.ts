import { Router } from 'express';
import * as controller from '../controllers/admin.controller';
import { validate } from '../middleware/validate';
import { requireAnyPermission, requirePermission } from '../middleware/rbac';
import { dateRangeQuery, idParam, listQuery } from '../validators/common.validator';
import {
  auditListQuery,
  createBranchSchema,
  createRoleSchema,
  createUserSchema,
  fileListQuery,
  notificationListQuery,
  overviewQuery,
  registerFileSchema,
  resetPasswordSchema,
  setPermissionsSchema,
  setRolesSchema,
  settingSchema,
  updateBranchSchema,
  updateOrganizationSchema,
  updateRoleSchema,
  updateUserSchema,
  uploadIntentSchema,
  userListQuery,
} from '../validators/admin.validator';

export const userRouter = Router();

userRouter.get(
  '/',
  requireAnyPermission('USER_VIEW', 'TEAM_VIEW', 'PROJECT_CREATE', 'TASK_CREATE'),
  validate({ query: userListQuery }),
  controller.listUsers,
);
userRouter.post(
  '/',
  requirePermission('USER_CREATE'),
  validate({ body: createUserSchema }),
  controller.createUser,
);
userRouter.get(
  '/:id',
  requirePermission('USER_VIEW'),
  validate({ params: idParam }),
  controller.getUser,
);
userRouter.patch(
  '/:id',
  requireAnyPermission('USER_UPDATE', 'TEAM_MANAGE'),
  validate({ params: idParam, body: updateUserSchema }),
  controller.updateUser,
);
userRouter.put(
  '/:id/roles',
  requirePermission('USER_MANAGE'),
  validate({ params: idParam, body: setRolesSchema }),
  controller.setUserRoles,
);
userRouter.post(
  '/:id/reset-password',
  requirePermission('USER_MANAGE'),
  validate({ params: idParam, body: resetPasswordSchema }),
  controller.resetUserPassword,
);
userRouter.delete(
  '/:id',
  requirePermission('USER_DELETE'),
  validate({ params: idParam }),
  controller.removeUser,
);

export const roleRouter = Router();

roleRouter.get('/', requirePermission('ROLE_VIEW'), controller.listRoles);
roleRouter.post(
  '/',
  requirePermission('ROLE_CREATE'),
  validate({ body: createRoleSchema }),
  controller.createRole,
);
roleRouter.get(
  '/:id',
  requirePermission('ROLE_VIEW'),
  validate({ params: idParam }),
  controller.getRole,
);
roleRouter.get(
  '/:id/users',
  requireAnyPermission('ROLE_VIEW', 'TEAM_VIEW'),
  validate({ params: idParam }),
  controller.listRoleUsers,
);
roleRouter.patch(
  '/:id',
  requirePermission('ROLE_UPDATE'),
  validate({ params: idParam, body: updateRoleSchema }),
  controller.updateRole,
);
roleRouter.put(
  '/:id/permissions',
  requirePermission('PERMISSION_ASSIGN'),
  validate({ params: idParam, body: setPermissionsSchema }),
  controller.setRolePermissions,
);
roleRouter.delete(
  '/:id',
  requirePermission('ROLE_DELETE'),
  validate({ params: idParam }),
  controller.removeRole,
);

export const permissionRouter = Router();
permissionRouter.get('/', requirePermission('PERMISSION_VIEW'), controller.listPermissions);

export const organizationRouter = Router();
organizationRouter.get('/current', requirePermission('ORG_VIEW'), controller.getOrganization);
organizationRouter.patch(
  '/current',
  requirePermission('ORG_UPDATE'),
  validate({ body: updateOrganizationSchema }),
  controller.updateOrganization,
);

export const branchRouter = Router();
branchRouter.get('/', requirePermission('BRANCH_VIEW'), controller.listBranches);
branchRouter.post(
  '/',
  requirePermission('BRANCH_CREATE'),
  validate({ body: createBranchSchema }),
  controller.createBranch,
);
branchRouter.patch(
  '/:id',
  requirePermission('BRANCH_UPDATE'),
  validate({ params: idParam, body: updateBranchSchema }),
  controller.updateBranch,
);
branchRouter.delete(
  '/:id',
  requirePermission('BRANCH_DELETE'),
  validate({ params: idParam }),
  controller.removeBranch,
);

export const fileRouter = Router();
fileRouter.get(
  '/',
  requirePermission('FILE_VIEW'),
  validate({ query: fileListQuery }),
  controller.listFiles,
);
fileRouter.post(
  '/upload-intent',
  requirePermission('FILE_UPLOAD'),
  validate({ body: uploadIntentSchema }),
  controller.createUploadIntent,
);
fileRouter.post(
  '/',
  requirePermission('FILE_UPLOAD'),
  validate({ body: registerFileSchema }),
  controller.registerFile,
);
fileRouter.get(
  '/:id/download-url',
  requirePermission('FILE_VIEW'),
  validate({ params: idParam }),
  controller.getDownloadUrl,
);
fileRouter.delete(
  '/:id',
  requirePermission('FILE_DELETE'),
  validate({ params: idParam }),
  controller.removeFile,
);

export const notificationRouter = Router();
notificationRouter.get(
  '/',
  requirePermission('NOTIFICATION_VIEW'),
  validate({ query: notificationListQuery }),
  controller.listNotifications,
);
notificationRouter.post(
  '/:id/read',
  requirePermission('NOTIFICATION_VIEW'),
  validate({ params: idParam }),
  controller.markNotificationRead,
);
notificationRouter.post(
  '/read-all',
  requirePermission('NOTIFICATION_VIEW'),
  controller.markAllNotificationsRead,
);

export const auditRouter = Router();
auditRouter.get(
  '/',
  requirePermission('AUDIT_VIEW'),
  validate({ query: auditListQuery }),
  controller.listAuditLogs,
);

export const settingRouter = Router();
settingRouter.get('/', requirePermission('SETTING_VIEW'), controller.listSettings);
settingRouter.put(
  '/',
  requirePermission('SETTING_UPDATE'),
  validate({ body: settingSchema }),
  controller.upsertSetting,
);

export const reportRouter = Router();
reportRouter.get(
  '/monthly-financials',
  requirePermission('REPORT_VIEW'),
  validate({ query: dateRangeQuery }),
  controller.monthlyFinancials,
);
reportRouter.get(
  '/lead-funnel',
  requirePermission('REPORT_VIEW'),
  validate({ query: dateRangeQuery }),
  controller.leadFunnel,
);
reportRouter.get(
  '/team-workload',
  requirePermission('REPORT_VIEW'),
  validate({ query: dateRangeQuery }),
  controller.teamWorkload,
);
reportRouter.get('/receivables-aging', requirePermission('REPORT_VIEW'), controller.receivablesAging);
reportRouter.get(
  '/profitability',
  requirePermission('REPORT_VIEW'),
  validate({ query: overviewQuery }),
  controller.profitability,
);

export const dataManagementRouter = Router();
dataManagementRouter.get(
  '/overview',
  requirePermission('DATA_MANAGEMENT_VIEW'),
  validate({ query: overviewQuery }),
  controller.dataManagementOverview,
);
dataManagementRouter.get(
  '/projects',
  requirePermission('DATA_MANAGEMENT_VIEW'),
  validate({ query: listQuery }),
  controller.dataManagementProjects,
);

/** `/team` is the employee-directory view over users. */
export const teamRouter = Router();
teamRouter.get(
  '/',
  requireAnyPermission('TEAM_VIEW', 'USER_VIEW', 'PROJECT_CREATE', 'TASK_CREATE'),
  validate({ query: userListQuery }),
  controller.listUsers,
);
teamRouter.get(
  '/:id',
  requirePermission('TEAM_VIEW'),
  validate({ params: idParam }),
  controller.getUser,
);

import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as userService from '../services/user.service';
import * as roleService from '../services/role.service';
import * as platformService from '../services/platform.service';
import * as fileService from '../services/file.service';
import * as reportService from '../services/report.service';
import * as dataManagementService from '../services/dataManagement.service';

// --- Users ----------------------------------------------------------------

export const listUsers = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await userService.listUsers(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getUser = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await userService.getUser(auth.organizationId, req.params.id));
});

export const createUser = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await userService.createUser(auth, req.body, auditContext(req)));
});

export const updateUser = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const user = await userService.updateUser(auth, req.params.id, req.body, auditContext(req));
  return sendSuccess(res, user);
});

export const setUserRoles = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const user = await userService.setUserRoles(
    auth,
    req.params.id,
    req.body.roleIds,
    auditContext(req),
  );
  return sendSuccess(res, user);
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await userService.resetUserPassword(auth, req.params.id, req.body.newPassword, auditContext(req));
  return sendSuccess(res, { passwordReset: true });
});

export const removeUser = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await userService.deleteUser(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Roles & permissions --------------------------------------------------

export const listRoles = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await roleService.listRoles(auth.organizationId));
});

export const getRole = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await roleService.getRole(auth.organizationId, req.params.id));
});

export const createRole = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await roleService.createRole(auth, req.body, auditContext(req)));
});

export const updateRole = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const role = await roleService.updateRole(auth, req.params.id, req.body, auditContext(req));
  return sendSuccess(res, role);
});

export const setRolePermissions = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const role = await roleService.setRolePermissions(
    auth,
    req.params.id,
    req.body.permissionKeys,
    auditContext(req),
  );
  return sendSuccess(res, role);
});

export const removeRole = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await roleService.deleteRole(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const listPermissions = asyncHandler(async (_req, res) =>
  sendSuccess(res, await roleService.listPermissions()),
);

// --- Organization & branches ---------------------------------------------

export const getOrganization = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.getOrganization(auth.organizationId));
});

export const updateOrganization = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.updateOrganization(auth, req.body, auditContext(req)));
});

export const listBranches = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.listBranches(auth.organizationId));
});

export const createBranch = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await platformService.createBranch(auth, req.body, auditContext(req)));
});

export const updateBranch = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await platformService.updateBranch(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const removeBranch = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await platformService.deleteBranch(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Files ----------------------------------------------------------------

export const listFiles = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await fileService.listFiles(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const createUploadIntent = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, fileService.createUploadIntent(auth, req.body));
});

export const registerFile = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await fileService.registerFile(auth, req.body, auditContext(req)));
});

export const getDownloadUrl = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await fileService.getDownloadUrl(auth.organizationId, req.params.id));
});

export const removeFile = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await fileService.deleteFile(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Notifications --------------------------------------------------------

export const listNotifications = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await platformService.listNotifications(auth.userId, req.query);
  const unread = await platformService.countUnread(auth.userId);
  return sendSuccess(res, items, { pagination, unread });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.markNotificationRead(auth.userId, req.params.id));
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.markAllNotificationsRead(auth.userId));
});

// --- Audit ----------------------------------------------------------------

export const listAuditLogs = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await platformService.listAuditLogs(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

// --- Settings -------------------------------------------------------------

export const listSettings = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await platformService.listSettings(auth.organizationId));
});

export const upsertSetting = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await platformService.upsertSetting(
      auth,
      req.body.key,
      req.body.value,
      req.body.description,
      auditContext(req),
    ),
  );
});

// --- Reports & data management -------------------------------------------

export const monthlyFinancials = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await reportService.getMonthlyFinancials(auth.organizationId, req.query));
});

export const leadFunnel = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await reportService.getLeadFunnel(auth.organizationId, req.query));
});

export const teamWorkload = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await reportService.getTeamWorkload(auth.organizationId, req.query));
});

export const receivablesAging = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await reportService.getReceivablesAging(auth.organizationId));
});

export const dataManagementOverview = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await dataManagementService.getOverview(auth.organizationId, req.query));
});

export const dataManagementProjects = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const result = await dataManagementService.getProjectDataStatus(auth.organizationId, req.query);
  return sendSuccess(res, result.items, {
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
      hasNext: result.page * result.limit < result.total,
      hasPrev: result.page > 1,
    },
  });
});

export const profitability = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  return sendSuccess(
    res,
    await dataManagementService.getProfitability(auth.organizationId, limit),
  );
});

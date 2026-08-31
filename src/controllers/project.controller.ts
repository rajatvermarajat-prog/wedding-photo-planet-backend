import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as projectService from '../services/project.service';
import * as eventService from '../services/event.service';
import * as shootService from '../services/shoot.service';

// --- Projects -------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await projectService.listProjects(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const get = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await projectService.getProject(auth.organizationId, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await projectService.createProject(auth, req.body, auditContext(req)));
});

export const update = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await projectService.updateProject(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const changeStatus = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await projectService.changeProjectStatus(
      auth,
      req.params.id,
      req.body.status,
      req.body.reason,
      auditContext(req),
    ),
  );
});

export const remove = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await projectService.deleteProject(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const removePaymentMilestone = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await projectService.deletePaymentMilestone(auth, req.params.id, req.params.milestoneId, req.body?.milestones, auditContext(req));
  return sendNoContent(res);
});

export const listPaymentMilestones = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await projectService.listPaymentMilestones(auth.organizationId, req.params.id));
});

export const statusHistory = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await projectService.getProjectStatusHistory(auth.organizationId, req.params.id),
  );
});

// --- Events ---------------------------------------------------------------

export const listEvents = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await eventService.listEvents(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getEvent = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await eventService.getEvent(auth.organizationId, req.params.id));
});

export const createEvent = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await eventService.createEvent(auth, req.body, auditContext(req)));
});

export const updateEvent = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await eventService.updateEvent(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const removeEvent = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await eventService.deleteEvent(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const listEventTypes = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await eventService.listEventTypes(auth.organizationId));
});

export const createEventType = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await eventService.createEventType(auth.organizationId, req.body));
});

// --- Shoots ---------------------------------------------------------------

export const listShoots = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await shootService.listShoots(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getShoot = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await shootService.getShoot(auth.organizationId, req.params.id));
});

export const createShoot = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await shootService.createShoot(auth, req.body, auditContext(req)));
});

export const updateShoot = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const body = auth.permissions.has('SHOOT_UPDATE')
    ? req.body
    : Object.fromEntries(
        Object.entries({
          dataSizeGb: req.body.dataSizeGb,
          dataReceivedAt: req.body.dataReceivedAt,
          backupDoneAt: req.body.backupDoneAt,
        }).filter(([, value]) => value !== undefined),
      );
  return sendSuccess(
    res,
    await shootService.updateShoot(auth, req.params.id, body, auditContext(req)),
  );
});

export const removeShoot = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await shootService.deleteShoot(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const assignCrew = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(
    res,
    await shootService.assignCrew(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const body = auth.permissions.has('SHOOT_ASSIGN')
    ? req.body
    : Object.fromEntries(
        Object.entries({
          dataReceived: req.body.dataReceived,
          dataSizeGb: req.body.dataSizeGb,
          storageReference: req.body.storageReference,
          notes: req.body.notes,
        }).filter(([, value]) => value !== undefined),
      );
  return sendSuccess(
    res,
    await shootService.updateAssignment(
      auth,
      req.params.id,
      req.params.assignmentId,
      body,
      auditContext(req),
    ),
  );
});

export const removeAssignment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await shootService.removeAssignment(
    auth,
    req.params.id,
    req.params.assignmentId,
    auditContext(req),
  );
  return sendNoContent(res);
});

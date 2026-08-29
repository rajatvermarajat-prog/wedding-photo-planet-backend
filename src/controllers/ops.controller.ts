import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as taskService from '../services/task.service';
import * as deliveryService from '../services/delivery.service';
import * as freelancerService from '../services/freelancer.service';
import * as attendanceService from '../services/attendance.service';
import * as personalTodoService from '../services/personalTodo.service';
import * as personalNoteService from '../services/personalNote.service';

// --- Tasks ----------------------------------------------------------------

export const listTasks = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await taskService.listTasks(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getTask = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await taskService.getTask(auth.organizationId, req.params.id));
});

export const createTask = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await taskService.createTask(auth, req.body, auditContext(req)));
});

export const updateTask = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await taskService.updateTask(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const changeTaskStatus = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await taskService.changeTaskStatus(
      auth,
      req.params.id,
      req.body.status,
      req.body.reason,
      auditContext(req),
    ),
  );
});

export const reassignTask = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await taskService.reassignTask(
      auth,
      req.params.id,
      req.body.toUserId,
      req.body.reason,
      auditContext(req),
    ),
  );
});

export const removeTask = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await taskService.deleteTask(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Deliveries -----------------------------------------------------------

export const listDeliveries = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await deliveryService.listDeliveries(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getDelivery = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await deliveryService.getDelivery(auth.organizationId, req.params.id));
});

export const createDelivery = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await deliveryService.createDelivery(auth, req.body, auditContext(req)));
});

export const updateDelivery = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await deliveryService.updateDelivery(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const changeDeliveryStatus = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await deliveryService.changeDeliveryStatus(
      auth,
      req.params.id,
      req.body.status,
      req.body.reason,
      auditContext(req),
    ),
  );
});

export const removeDelivery = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await deliveryService.deleteDelivery(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Freelancers ----------------------------------------------------------

export const listFreelancers = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await freelancerService.listFreelancers(
    auth.organizationId,
    req.query,
  );
  return sendSuccess(res, items, { pagination });
});

export const getFreelancer = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await freelancerService.getFreelancer(auth.organizationId, req.params.id));
});

export const createFreelancer = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await freelancerService.createFreelancer(auth, req.body, auditContext(req)));
});

export const updateFreelancer = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await freelancerService.updateFreelancer(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const removeFreelancer = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await freelancerService.deleteFreelancer(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const recordPayout = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(
    res,
    await freelancerService.recordPayout(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const freelancerLedger = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await freelancerService.getFreelancerLedger(auth.organizationId, req.params.id),
  );
});

// --- Attendance & leave ---------------------------------------------------

export const listAttendance = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await attendanceService.listAttendance(
    auth.organizationId,
    req.query,
  );
  return sendSuccess(res, items, { pagination });
});

export const markAttendance = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const canManageOthers = auth.permissions.has('ATTENDANCE_MANAGE');
  return sendCreated(
    res,
    await attendanceService.markAttendance(auth, req.body, canManageOthers, auditContext(req)),
  );
});

export const attendanceSummary = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await attendanceService.getAttendanceSummary(auth.organizationId, req.query),
  );
});

export const listLeave = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await attendanceService.listLeaveRequests(
    auth.organizationId,
    req.query,
  );
  return sendSuccess(res, items, { pagination });
});

export const requestLeave = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await attendanceService.requestLeave(auth, req.body, auditContext(req)));
});

export const reviewLeave = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await attendanceService.reviewLeave(
      auth,
      req.params.id,
      req.body.decision,
      req.body.note,
      auditContext(req),
    ),
  );
});

// --- Personal to-dos (always scoped to the signed-in user) ----------------

export const listPersonalTodos = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await personalTodoService.listPersonalTodos(auth, req.query);
  return sendSuccess(res, items, { pagination });
});

export const createPersonalTodo = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await personalTodoService.createPersonalTodo(auth, req.body));
});

export const updatePersonalTodo = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await personalTodoService.updatePersonalTodo(auth, req.params.id, req.body));
});

export const removePersonalTodo = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await personalTodoService.deletePersonalTodo(auth, req.params.id);
  return sendNoContent(res);
});

export const clearCompletedPersonalTodos = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const result = await personalTodoService.clearCompletedPersonalTodos(auth);
  return sendSuccess(res, { cleared: result.count });
});

export const listPersonalNotes = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await personalNoteService.listPersonalNotes(auth));
});

export const createPersonalNote = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await personalNoteService.createPersonalNote(auth, req.body));
});

export const updatePersonalNote = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await personalNoteService.updatePersonalNote(auth, req.params.id, req.body));
});

export const reorderPersonalNotes = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await personalNoteService.reorderPersonalNotes(auth, req.body.ids));
});

export const removePersonalNote = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await personalNoteService.deletePersonalNote(auth, req.params.id);
  return sendNoContent(res);
});

import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as clientService from '../services/client.service';
import * as leadService from '../services/lead.service';
import { prisma } from '../config/prisma';

// --- Clients --------------------------------------------------------------

export const listClients = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await clientService.listClients(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getClient = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await clientService.getClient(auth.organizationId, req.params.id));
});

export const createClient = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const client = await clientService.createClient(auth, req.body, auditContext(req));
  return sendCreated(res, client);
});

export const updateClient = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const client = await clientService.updateClient(auth, req.params.id, req.body, auditContext(req));
  return sendSuccess(res, client);
});

export const deleteClient = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await clientService.deleteClient(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const addClientNote = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const note = await clientService.addClientNote(
    auth,
    req.params.id,
    req.body.body,
    req.body.isPinned,
    auditContext(req),
  );
  return sendCreated(res, note);
});

// --- Leads ----------------------------------------------------------------

export const listLeads = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await leadService.listLeads(auth, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getLead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await leadService.getLead(auth, req.params.id));
});

export const createLead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await leadService.createLead(auth, req.body, auditContext(req)));
});

export const updateLead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await leadService.updateLead(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const deleteLead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await leadService.deleteLead(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

export const addFollowUp = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(
    res,
    await leadService.addFollowUp(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const convertLead = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await leadService.convertLead(auth, req.params.id, req.body, auditContext(req)),
  );
});

export const listLeadSources = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await prisma.leadSource.findMany({
      where: { organizationId: auth.organizationId, isActive: true },
      orderBy: { name: 'asc' },
    }),
  );
});

export const createLeadSource = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(
    res,
    await prisma.leadSource.create({
      data: { organizationId: auth.organizationId, ...req.body },
    }),
  );
});

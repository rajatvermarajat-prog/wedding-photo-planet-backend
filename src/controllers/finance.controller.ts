import { asyncHandler, auditContext, requireAuthContext } from '../utils/http';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as quotationService from '../services/quotation.service';
import * as invoiceService from '../services/invoice.service';
import * as paymentService from '../services/payment.service';
import * as expenseService from '../services/expense.service';
import * as incomeService from '../services/income.service';
import { prisma } from '../config/prisma';
import { startOfMonth } from '../utils/date';

// --- Quotations -----------------------------------------------------------

export const listQuotations = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await quotationService.listQuotations(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getQuotation = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await quotationService.getQuotation(auth.organizationId, req.params.id));
});

export const createQuotation = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await quotationService.createQuotation(auth, req.body, auditContext(req)));
});

export const updateQuotationStatus = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await quotationService.updateQuotationStatus(
      auth,
      req.params.id,
      req.body.status,
      auditContext(req),
    ),
  );
});

export const removeQuotation = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await quotationService.deleteQuotation(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});

// --- Invoices -------------------------------------------------------------

export const listInvoices = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await invoiceService.listInvoices(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getInvoice = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await invoiceService.getInvoice(auth.organizationId, req.params.id));
});

export const createInvoice = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await invoiceService.createInvoice(auth, req.body, auditContext(req)));
});

export const updateInvoiceStatus = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await invoiceService.updateInvoiceStatus(auth, req.params.id, req.body.status, auditContext(req)),
  );
});

// --- Payments -------------------------------------------------------------

export const listPayments = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await paymentService.listPayments(auth.organizationId, req.query);
  return sendSuccess(res, items.map((item: any) => expenseService.withPaymentStatus(item)), { pagination });
});

export const getPayment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await paymentService.getPayment(auth.organizationId, req.params.id));
});

export const createPayment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await paymentService.createPayment(auth, req.body, auditContext(req)));
});

export const allocatePayment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await paymentService.allocatePayment(
      auth,
      req.params.id,
      req.body.allocations,
      auditContext(req),
    ),
  );
});

export const refundPayment = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(
    res,
    await paymentService.refundPayment(auth, req.params.id, req.body.reason, auditContext(req)),
  );
});

// --- Expenses -------------------------------------------------------------

export const listExpenses = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  const { items, pagination } = await expenseService.listExpenses(auth.organizationId, req.query);
  return sendSuccess(res, items, { pagination });
});

export const getExpense = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, expenseService.withPaymentStatus(await expenseService.getExpense(auth.organizationId, req.params.id) as any));
});

export const createExpense = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, expenseService.withPaymentStatus(await expenseService.createExpense(auth, req.body, auditContext(req))));
});

export const updateExpense = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    expenseService.withPaymentStatus(await expenseService.updateExpense(auth, req.params.id, req.body, auditContext(req))),
  );
});

export const reviewExpense = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(
    res,
    await expenseService.reviewExpense(
      auth,
      req.params.id,
      req.body.decision,
      req.body.reason,
      auditContext(req),
    ),
  );
});

export const removeExpense = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  await expenseService.deleteExpense(auth, req.params.id, auditContext(req));
  return sendNoContent(res);
});
export const addExpensePayment = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendCreated(res, await expenseService.addExpensePayment(auth, req.params.id, req.body, auditContext(req))); });

export const listExpenseCategories = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await expenseService.listExpenseCategories(auth.organizationId));
});

export const createExpenseCategory = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendCreated(res, await expenseService.createExpenseCategory(auth.organizationId, req.body));
});
export const expenseSummary = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendSuccess(res, await expenseService.summary(auth.organizationId)); });
export const profitLoss = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); const now = new Date(); const since = req.query.period === 'year' ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) : startOfMonth(now); const where = { organizationId: auth.organizationId, deletedAt: null, }; const [income, expense] = await prisma.$transaction([prisma.income.aggregate({ where: { ...where, date: { gte: since } }, _sum: { amount: true } }), prisma.expense.aggregate({ where: { ...where, expenseDate: { gte: since } }, _sum: { amount: true } })]); const totalIncome = income._sum.amount ?? 0; const totalExpense = expense._sum.amount ?? 0; return sendSuccess(res, { totalIncome, totalExpense, netProfit: Number(totalIncome) - Number(totalExpense) }); });

export const listIncomes = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); const { items, pagination } = await incomeService.listIncomes(auth.organizationId, req.query); return sendSuccess(res, items, { pagination }); });
export const getIncome = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendSuccess(res, await incomeService.getIncome(auth.organizationId, req.params.id)); });
export const createIncome = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendCreated(res, await incomeService.createIncome(auth, req.body, auditContext(req))); });
export const updateIncome = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendSuccess(res, await incomeService.updateIncome(auth, req.params.id, req.body, auditContext(req))); });
export const removeIncome = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); await incomeService.deleteIncome(auth, req.params.id, auditContext(req)); return sendNoContent(res); });
export const incomeSummary = asyncHandler(async (req, res) => { const auth = requireAuthContext(req); return sendSuccess(res, await incomeService.summary(auth.organizationId)); });

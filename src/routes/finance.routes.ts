import { Router } from 'express';
import * as controller from '../controllers/finance.controller';
import { validate } from '../middleware/validate';
import { requirePermission } from '../middleware/rbac';
import { idempotent } from '../middleware/idempotency';
import { idParam } from '../validators/common.validator';
import {
  allocatePaymentSchema,
  createExpenseSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createQuotationSchema,
  expenseCategorySchema,
  expenseListQuery,
  invoiceListQuery,
  invoiceStatusSchema,
  paymentListQuery,
  quotationListQuery,
  quotationStatusSchema,
  refundPaymentSchema,
  reviewExpenseSchema,
  updateExpenseSchema,
} from '../validators/finance.validator';

export const quotationRouter = Router();

quotationRouter.get(
  '/',
  requirePermission('QUOTATION_VIEW'),
  validate({ query: quotationListQuery }),
  controller.listQuotations,
);
quotationRouter.post(
  '/',
  requirePermission('QUOTATION_CREATE'),
  validate({ body: createQuotationSchema }),
  controller.createQuotation,
);
quotationRouter.get(
  '/:id',
  requirePermission('QUOTATION_VIEW'),
  validate({ params: idParam }),
  controller.getQuotation,
);
quotationRouter.patch(
  '/:id/status',
  requirePermission('QUOTATION_UPDATE'),
  validate({ params: idParam, body: quotationStatusSchema }),
  controller.updateQuotationStatus,
);
quotationRouter.delete(
  '/:id',
  requirePermission('QUOTATION_DELETE'),
  validate({ params: idParam }),
  controller.removeQuotation,
);

export const invoiceRouter = Router();

invoiceRouter.get(
  '/',
  requirePermission('INVOICE_VIEW'),
  validate({ query: invoiceListQuery }),
  controller.listInvoices,
);
// Idempotent: a retried invoice creation must never raise a second invoice.
invoiceRouter.post(
  '/',
  requirePermission('INVOICE_CREATE'),
  validate({ body: createInvoiceSchema }),
  idempotent(),
  controller.createInvoice,
);
invoiceRouter.get(
  '/:id',
  requirePermission('INVOICE_VIEW'),
  validate({ params: idParam }),
  controller.getInvoice,
);
invoiceRouter.patch(
  '/:id/status',
  requirePermission('INVOICE_UPDATE'),
  validate({ params: idParam, body: invoiceStatusSchema }),
  controller.updateInvoiceStatus,
);

export const paymentRouter = Router();

paymentRouter.get(
  '/',
  requirePermission('PAYMENT_VIEW'),
  validate({ query: paymentListQuery }),
  controller.listPayments,
);
// Idempotency-Key is mandatory here: a duplicate submission must never book
// the same money twice (§35).
paymentRouter.post(
  '/',
  requirePermission('PAYMENT_CREATE'),
  validate({ body: createPaymentSchema }),
  idempotent({ required: true }),
  controller.createPayment,
);
paymentRouter.get(
  '/:id',
  requirePermission('PAYMENT_VIEW'),
  validate({ params: idParam }),
  controller.getPayment,
);
paymentRouter.post(
  '/:id/allocations',
  requirePermission('PAYMENT_ALLOCATE'),
  validate({ params: idParam, body: allocatePaymentSchema }),
  idempotent(),
  controller.allocatePayment,
);
paymentRouter.post(
  '/:id/refund',
  requirePermission('PAYMENT_UPDATE'),
  validate({ params: idParam, body: refundPaymentSchema }),
  idempotent({ required: true }),
  controller.refundPayment,
);

export const expenseRouter = Router();

expenseRouter.get(
  '/',
  requirePermission('EXPENSE_VIEW'),
  validate({ query: expenseListQuery }),
  controller.listExpenses,
);
expenseRouter.post(
  '/',
  requirePermission('EXPENSE_CREATE'),
  validate({ body: createExpenseSchema }),
  controller.createExpense,
);
expenseRouter.get('/categories', requirePermission('EXPENSE_VIEW'), controller.listExpenseCategories);
expenseRouter.post(
  '/categories',
  requirePermission('EXPENSE_CREATE'),
  validate({ body: expenseCategorySchema }),
  controller.createExpenseCategory,
);
expenseRouter.get(
  '/:id',
  requirePermission('EXPENSE_VIEW'),
  validate({ params: idParam }),
  controller.getExpense,
);
expenseRouter.patch(
  '/:id',
  requirePermission('EXPENSE_UPDATE'),
  validate({ params: idParam, body: updateExpenseSchema }),
  controller.updateExpense,
);
expenseRouter.post(
  '/:id/review',
  requirePermission('EXPENSE_APPROVE'),
  validate({ params: idParam, body: reviewExpenseSchema }),
  controller.reviewExpense,
);
expenseRouter.delete(
  '/:id',
  requirePermission('EXPENSE_DELETE'),
  validate({ params: idParam }),
  controller.removeExpense,
);

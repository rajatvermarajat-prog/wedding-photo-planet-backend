import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, idempotencyKey, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('finance: invoices, payments, allocation', () => {
  let org: TestOrg;
  let token: string;
  let clientId: string;
  let projectId: string;

  const invoiceFor = async (total: string) => {
    const response = await authed(token)
      .post(`${base}/invoices`)
      .set('Idempotency-Key', idempotencyKey('inv'))
      .send({
        clientId,
        projectId,
        issueDate: '2026-01-10',
        dueDate: '2026-02-10',
        items: [{ service: 'Wedding coverage', quantity: '1', unitPrice: total }],
      })
      .expect(201);
    return response.body.data;
  };

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    token = await login(org.admin);

    const client = await authed(token)
      .post(`${base}/clients`)
      .send({ displayName: 'Test Couple', primaryPhone: '+919812345678' })
      .expect(201);
    clientId = client.body.data.id;

    const project = await authed(token)
      .post(`${base}/projects`)
      .send({ clientId, name: 'Test Wedding', weddingDate: '2026-12-14' })
      .expect(201);
    projectId = project.body.data.id;
  });

  it('computes invoice totals from its line items', async () => {
    const invoice = await authed(token)
      .post(`${base}/invoices`)
      .set('Idempotency-Key', idempotencyKey('inv'))
      .send({
        clientId,
        issueDate: '2026-01-10',
        items: [
          { service: 'Photography', quantity: '2', unitPrice: '100000.00', taxRate: 18 },
          { service: 'Album', quantity: '1', unitPrice: '25000.00', discountAmount: '5000.00' },
        ],
      })
      .expect(201);

    // (2 x 100000) + (1 x 25000) = 225000 gross
    // discounts 5000 -> net 220000 ; tax = 18% of 200000 = 36000
    expect(invoice.body.data.subtotal).toBe('225000');
    expect(invoice.body.data.discountAmount).toBe('5000');
    expect(invoice.body.data.taxAmount).toBe('36000');
    expect(invoice.body.data.total).toBe('256000');
    expect(invoice.body.data.amountDue).toBe('256000');
  });

  it('rejects an invoice whose due date precedes its issue date', async () => {
    const response = await authed(token)
      .post(`${base}/invoices`)
      .set('Idempotency-Key', idempotencyKey('inv'))
      .send({
        clientId,
        issueDate: '2026-02-10',
        dueDate: '2026-01-10',
        items: [{ service: 'X', quantity: '1', unitPrice: '100.00' }],
      });
    expect(response.status).toBe(400);
  });

  it('records a payment and allocates it against an invoice', async () => {
    const invoice = await invoiceFor('100000.00');

    const payment = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        projectId,
        amount: '40000.00',
        paymentDate: '2026-01-15',
        paymentMethod: 'BANK_TRANSFER',
        transactionReference: 'UTR-0001',
        allocations: [{ invoiceId: invoice.id, amount: '40000.00' }],
      })
      .expect(201);

    expect(payment.body.data.paymentNumber).toMatch(/^PAY-\d{4}-\d{4}$/);
    expect(payment.body.data.allocatedAmount).toBe('40000');

    const refreshed = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshed.amountPaid.toFixed(2)).toBe('40000.00');
    expect(refreshed.amountDue.toFixed(2)).toBe('60000.00');
    expect(refreshed.status).toBe('PARTIALLY_PAID');
  });

  it('marks an invoice PAID once fully settled', async () => {
    const invoice = await invoiceFor('50000.00');

    await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        amount: '50000.00',
        paymentDate: '2026-01-15',
        allocations: [{ invoiceId: invoice.id, amount: '50000.00' }],
      })
      .expect(201);

    const refreshed = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshed.status).toBe('PAID');
    expect(refreshed.amountDue.toFixed(2)).toBe('0.00');
    expect(refreshed.settledAt).not.toBeNull();
  });

  it('splits one payment across two invoices', async () => {
    const first = await invoiceFor('30000.00');
    const second = await invoiceFor('20000.00');

    await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        amount: '50000.00',
        paymentDate: '2026-01-15',
        allocations: [
          { invoiceId: first.id, amount: '30000.00' },
          { invoiceId: second.id, amount: '20000.00' },
        ],
      })
      .expect(201);

    const invoices = await prisma.invoice.findMany({ orderBy: { invoiceNumber: 'asc' } });
    expect(invoices.every((i) => i.status === 'PAID')).toBe(true);
  });

  it('refuses to allocate more than the payment amount', async () => {
    const invoice = await invoiceFor('100000.00');

    const response = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        amount: '10000.00',
        paymentDate: '2026-01-15',
        allocations: [{ invoiceId: invoice.id, amount: '50000.00' }],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/allocations total/i);
    // The whole transaction rolled back — no orphan payment row.
    expect(await prisma.payment.count()).toBe(0);
  });

  it('refuses to over-settle an invoice', async () => {
    const invoice = await invoiceFor('10000.00');

    const response = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        amount: '50000.00',
        paymentDate: '2026-01-15',
        allocations: [{ invoiceId: invoice.id, amount: '50000.00' }],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/outstanding/i);
  });

  it('rejects a duplicate transaction reference', async () => {
    await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({ clientId, amount: '1000.00', paymentDate: '2026-01-15', transactionReference: 'UTR-DUP' })
      .expect(201);

    const duplicate = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({ clientId, amount: '1000.00', paymentDate: '2026-01-15', transactionReference: 'UTR-DUP' });

    expect(duplicate.status).toBe(409);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('replays the original response when a payment is retried with the same idempotency key', async () => {
    const key = idempotencyKey('retry');
    const body = { clientId, amount: '25000.00', paymentDate: '2026-01-15' };

    const first = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const retry = await authed(token).post(`${base}/payments`).set('Idempotency-Key', key).send(body);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.data.id);
    // The retry must not have booked the money a second time.
    expect(await prisma.payment.count()).toBe(1);
  });

  it('rejects the same idempotency key used with a different body', async () => {
    const key = idempotencyKey('mismatch');
    await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', key)
      .send({ clientId, amount: '100.00', paymentDate: '2026-01-15' })
      .expect(201);

    const different = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', key)
      .send({ clientId, amount: '999.00', paymentDate: '2026-01-15' });

    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('requires an idempotency key on payment creation', async () => {
    const response = await authed(token)
      .post(`${base}/payments`)
      .send({ clientId, amount: '100.00', paymentDate: '2026-01-15' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/idempotency-key/i);
  });

  it('rejects a zero or negative payment', async () => {
    for (const amount of ['0.00', '-100.00']) {
      const response = await authed(token)
        .post(`${base}/payments`)
        .set('Idempotency-Key', idempotencyKey('bad'))
        .send({ clientId, amount, paymentDate: '2026-01-15' });
      expect(response.status).toBe(400);
    }
  });

  it('reverses a payment without deleting anything', async () => {
    const invoice = await invoiceFor('50000.00');
    const payment = await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({
        clientId,
        amount: '50000.00',
        paymentDate: '2026-01-15',
        allocations: [{ invoiceId: invoice.id, amount: '50000.00' }],
      })
      .expect(201);

    await authed(token)
      .post(`${base}/payments/${payment.body.data.id}/refund`)
      .set('Idempotency-Key', idempotencyKey('refund'))
      .send({ reason: 'Client cancelled' })
      .expect(201);

    // Original retained, reversal added, invoice balance restored.
    const payments = await prisma.payment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(payments).toHaveLength(2);
    expect(payments[0].status).toBe('REFUNDED');
    expect(payments[1].reversalOfPaymentId).toBe(payments[0].id);

    const refreshed = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshed.amountDue.toFixed(2)).toBe('50000.00');
    expect(refreshed.status).not.toBe('PAID');
  });

  it('keeps the invoice derived cache consistent with its allocations', async () => {
    const invoice = await invoiceFor('90000.00');

    for (const amount of ['30000.00', '30000.00', '30000.00']) {
      await authed(token)
        .post(`${base}/payments`)
        .set('Idempotency-Key', idempotencyKey('pay'))
        .send({
          clientId,
          amount,
          paymentDate: '2026-01-15',
          allocations: [{ invoiceId: invoice.id, amount }],
        })
        .expect(201);
    }

    const refreshed = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const allocated = await prisma.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amount: true },
    });

    expect(refreshed.amountPaid.toFixed(2)).toBe(allocated._sum.amount?.toFixed(2));
    expect(refreshed.amountDue.toFixed(2)).toBe('0.00');
    expect(refreshed.status).toBe('PAID');
  });

  it('writes an audit entry for every recorded payment', async () => {
    await authed(token)
      .post(`${base}/payments`)
      .set('Idempotency-Key', idempotencyKey('pay'))
      .send({ clientId, amount: '1000.00', paymentDate: '2026-01-15' })
      .expect(201);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'PAYMENT_RECORDED' } });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('Payment');
    expect(audit?.actorId).toBe(org.admin.id);
  });
});

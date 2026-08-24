import { Tx } from '../config/prisma';

export type DocumentKind =
  | 'PROJECT'
  | 'CLIENT'
  | 'QUOTATION'
  | 'INVOICE'
  | 'PAYMENT'
  | 'FREELANCER';

const CONFIG: Record<DocumentKind, { prefix: string; table: string; column: string; yearly: boolean }> = {
  PROJECT: { prefix: 'PRJ', table: 'projects', column: 'project_number', yearly: true },
  CLIENT: { prefix: 'CLI', table: 'clients', column: 'client_code', yearly: false },
  QUOTATION: { prefix: 'QTN', table: 'quotations', column: 'quotation_number', yearly: true },
  INVOICE: { prefix: 'INV', table: 'invoices', column: 'invoice_number', yearly: true },
  PAYMENT: { prefix: 'PAY', table: 'payments', column: 'payment_number', yearly: true },
  FREELANCER: { prefix: 'FRL', table: 'freelancers', column: 'code', yearly: false },
};

/**
 * Allocates the next human-readable document number for an organization.
 *
 * Concurrency (§36): a transaction-scoped advisory lock keyed on
 * organization+kind serialises allocation, so two admins creating an invoice
 * at the same instant queue rather than race. The lock is released on COMMIT
 * or ROLLBACK by PostgreSQL itself. The `@@unique([organizationId, <number>])`
 * constraint remains the final backstop.
 *
 * MUST be called inside a transaction — an advisory *xact* lock outside one
 * would be released immediately and provide no protection.
 */
export async function nextDocumentNumber(
  tx: Tx,
  organizationId: string,
  kind: DocumentKind,
): Promise<string> {
  const { prefix, table, column, yearly } = CONFIG[kind];
  const lockKey = `docnum:${organizationId}:${kind}`;

  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', lockKey);

  const year = new Date().getUTCFullYear();
  const scope = yearly ? `${prefix}-${year}-` : `${prefix}-`;

  const rows = await tx.$queryRawUnsafe<{ max_seq: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${column}" FROM '[0-9]+$') AS INTEGER)) AS max_seq
       FROM "${table}"
      WHERE "organization_id" = $1::uuid
        AND "${column}" LIKE $2`,
    organizationId,
    `${scope}%`,
  );

  const next = (rows[0]?.max_seq ?? 0) + 1;
  return `${scope}${String(next).padStart(4, '0')}`;
}

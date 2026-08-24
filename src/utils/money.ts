import { Prisma } from '@prisma/client';

export type Money = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export const money = (value: Prisma.Decimal.Value): Money => new Prisma.Decimal(value);
export const ZERO = (): Money => new Prisma.Decimal(0);

/** Rounds to 2dp, half-up — matches `numeric(14,2)` storage exactly. */
export const round2 = (value: Money): Money =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: Prisma.Decimal.Value[]): Money =>
  values.reduce<Money>((acc, v) => acc.plus(v), ZERO());

export interface LineInput {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountAmount?: Prisma.Decimal.Value;
  taxRate?: Prisma.Decimal.Value;
}

export interface ComputedLine {
  quantity: Money;
  unitPrice: Money;
  discountAmount: Money;
  taxRate: Money;
  taxAmount: Money;
  lineTotal: Money;
}

/**
 * Single source of truth for line arithmetic, shared by quotations and
 * invoices so both documents can never disagree on how a total is reached.
 *
 *   gross = quantity x unitPrice
 *   net   = gross - discount
 *   tax   = net x taxRate%
 *   total = net + tax
 */
export function computeLine(input: LineInput): ComputedLine {
  const quantity = money(input.quantity);
  const unitPrice = money(input.unitPrice);
  const discountAmount = round2(money(input.discountAmount ?? 0));
  const taxRate = money(input.taxRate ?? 0);

  const gross = round2(quantity.times(unitPrice));
  const net = round2(gross.minus(discountAmount));
  const taxAmount = round2(net.times(taxRate).dividedBy(100));
  const lineTotal = round2(net.plus(taxAmount));

  return { quantity, unitPrice, discountAmount, taxRate, taxAmount, lineTotal };
}

export interface DocumentTotals {
  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  total: Money;
}

/**
 * Rolls computed lines into document totals. `documentDiscount` is applied on
 * top of any per-line discounts.
 */
export function computeDocumentTotals(
  lines: ComputedLine[],
  documentDiscount: Prisma.Decimal.Value = 0,
): DocumentTotals {
  const gross = round2(sum(lines.map((l) => l.quantity.times(l.unitPrice))));
  const lineDiscounts = round2(sum(lines.map((l) => l.discountAmount)));
  const taxAmount = round2(sum(lines.map((l) => l.taxAmount)));
  const docDiscount = round2(money(documentDiscount));
  const discountAmount = round2(lineDiscounts.plus(docDiscount));
  const total = round2(gross.minus(discountAmount).plus(taxAmount));

  return { subtotal: gross, discountAmount, taxAmount, total };
}

import { Prisma } from '@prisma/client';
import { MetaLeadDetails } from './meta.types';

const NAME_KEYS = ['full_name', 'name', 'your_name', 'first_name'];
const PHONE_KEYS = ['phone_number', 'phone', 'mobile_number', 'mobile'];
const EMAIL_KEYS = ['email'];
const CITY_KEYS = ['city', 'venue_city', 'location', 'base_city'];
const EVENT_KEYS = ['event_date', 'wedding_date', 'date'];
const BUDGET_KEYS = ['budget', 'estimated_budget', 'expected_budget'];

function firstValue(fields: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (value) return value;
  }
  return undefined;
}

function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseMoney(value: string | undefined): Prisma.Decimal.Value | undefined {
  if (!value) return undefined;
  const numeric = value.replace(/[^0-9.]/g, '');
  return numeric ? numeric : undefined;
}

export function mapMetaLeadToCrmLead(details: MetaLeadDetails) {
  const fields: Record<string, string> = {};
  for (const field of details.field_data ?? []) {
    const key = normalizeFieldName(field.name);
    const value = field.values?.find(Boolean)?.trim();
    if (key && value) fields[key] = value;
  }

  const phone = firstValue(fields, PHONE_KEYS);

  return {
    name: firstValue(fields, NAME_KEYS) ?? phone ?? `Meta lead ${details.id}`,
    phone: phone ?? 'UNKNOWN',
    email: firstValue(fields, EMAIL_KEYS),
    venueCity: firstValue(fields, CITY_KEYS),
    eventDate: parseDate(firstValue(fields, EVENT_KEYS)),
    estimatedValue: parseMoney(firstValue(fields, BUDGET_KEYS)),
    externalId: details.id,
    externalFormId: details.form_id,
    externalAdId: details.ad_id,
    notes: [
      'Imported from Meta Lead Ads.',
      details.campaign_id ? `Campaign ID: ${details.campaign_id}` : undefined,
      details.adset_id ? `Ad Set ID: ${details.adset_id}` : undefined,
    ].filter(Boolean).join('\n'),
    customFields: fields,
  };
}

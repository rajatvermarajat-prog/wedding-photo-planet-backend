-- Meta Lead Ads integration metadata.
-- Additive only: no existing lead rows are modified.

ALTER TABLE "leads"
  ADD COLUMN "external_provider" VARCHAR(40),
  ADD COLUMN "external_id" VARCHAR(120),
  ADD COLUMN "external_form_id" VARCHAR(120),
  ADD COLUMN "external_ad_id" VARCHAR(120),
  ADD COLUMN "raw_payload" JSONB,
  ADD COLUMN "custom_fields" JSONB;

CREATE INDEX "leads_organization_id_external_provider_idx"
  ON "leads"("organization_id", "external_provider");

CREATE UNIQUE INDEX "leads_organization_id_external_provider_external_id_key"
  ON "leads"("organization_id", "external_provider", "external_id");

CREATE TABLE "meta_lead_integrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "page_id" VARCHAR(120) NOT NULL,
  "page_name" VARCHAR(160),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "webhook_verified_at" TIMESTAMPTZ(6),
  "last_webhook_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "settings" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "meta_lead_integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_lead_integrations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "meta_lead_integrations_page_id_key"
  ON "meta_lead_integrations"("page_id");

CREATE INDEX "meta_lead_integrations_organization_id_is_active_idx"
  ON "meta_lead_integrations"("organization_id", "is_active");

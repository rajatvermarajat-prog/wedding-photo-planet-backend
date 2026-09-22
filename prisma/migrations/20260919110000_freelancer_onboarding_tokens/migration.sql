CREATE TABLE "freelancer_onboarding_tokens" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "application_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freelancer_onboarding_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "freelancer_onboarding_tokens_token_hash_key"
  ON "freelancer_onboarding_tokens"("token_hash");

CREATE UNIQUE INDEX "freelancer_onboarding_tokens_one_active_per_freelancer_idx"
  ON "freelancer_onboarding_tokens"("freelancer_id")
  WHERE "used_at" IS NULL AND "invalidated_at" IS NULL;

CREATE INDEX "freelancer_onboarding_tokens_freelancer_id_used_at_invalidated_at_expires_at_idx"
  ON "freelancer_onboarding_tokens"("freelancer_id", "used_at", "invalidated_at", "expires_at");

CREATE INDEX "freelancer_onboarding_tokens_application_id_idx"
  ON "freelancer_onboarding_tokens"("application_id");

CREATE INDEX "freelancer_onboarding_tokens_created_by_id_idx"
  ON "freelancer_onboarding_tokens"("created_by_id");

ALTER TABLE "freelancer_onboarding_tokens"
  ADD CONSTRAINT "freelancer_onboarding_tokens_freelancer_id_fkey"
  FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "freelancer_onboarding_tokens"
  ADD CONSTRAINT "freelancer_onboarding_tokens_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "freelancer_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "freelancer_onboarding_tokens"
  ADD CONSTRAINT "freelancer_onboarding_tokens_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

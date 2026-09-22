-- AlterTable
ALTER TABLE "freelancers" ADD COLUMN "password_hash" VARCHAR(255),
ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "locked_until" TIMESTAMPTZ(6),
ADD COLUMN "last_login_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "freelancer_sessions" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" "LogoutReason",

    CONSTRAINT "freelancer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "freelancer_sessions_refresh_token_hash_key" ON "freelancer_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "freelancer_sessions_freelancer_id_status_idx" ON "freelancer_sessions"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_sessions_expires_at_idx" ON "freelancer_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "freelancer_sessions" ADD CONSTRAINT "freelancer_sessions_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FreelancerSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FreelancerAvailabilityStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_AVAILABLE', 'UNAVAILABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FreelancerApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FreelancerConnectionStatus" AS ENUM ('INTERESTED', 'CONTACTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'ASSIGNED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "freelancer_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "price" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "features" JSONB,
    "limits" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_subscriptions" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "FreelancerSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "external_customer_id" VARCHAR(160),
    "external_subscription_id" VARCHAR(160),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_availability" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "FreelancerAvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "start_time" TIMESTAMPTZ(6),
    "end_time" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_portfolio_items" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "file_object_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(80),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "freelancer_id" UUID,
    "full_name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "whatsapp" VARCHAR(32),
    "email" VARCHAR(160),
    "city" VARCHAR(80),
    "primary_skill" "CrewRole" NOT NULL DEFAULT 'LEAD_PHOTOGRAPHER',
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "experience_years" INTEGER,
    "portfolio_url" VARCHAR(1024),
    "expected_rate" NUMERIC(14,2),
    "rate_type" "RateType" NOT NULL DEFAULT 'PER_DAY',
    "status" "FreelancerApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_id" UUID,
    "rejection_reason" VARCHAR(500),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "project_id" UUID,
    "shoot_id" UUID,
    "created_by_id" UUID,
    "status" "FreelancerConnectionStatus" NOT NULL DEFAULT 'INTERESTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "freelancer_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "freelancer_plans_organization_id_slug_key" ON "freelancer_plans"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "freelancer_plans_organization_id_is_active_idx" ON "freelancer_plans"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "freelancer_subscriptions_freelancer_id_status_idx" ON "freelancer_subscriptions"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_subscriptions_plan_id_status_idx" ON "freelancer_subscriptions"("plan_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_subscriptions_status_current_period_end_idx" ON "freelancer_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "freelancer_availability_freelancer_id_date_key" ON "freelancer_availability"("freelancer_id", "date");

-- CreateIndex
CREATE INDEX "freelancer_availability_date_status_idx" ON "freelancer_availability"("date", "status");

-- CreateIndex
CREATE INDEX "freelancer_availability_freelancer_id_status_idx" ON "freelancer_availability"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_portfolio_items_freelancer_id_is_published_sort_order_idx" ON "freelancer_portfolio_items"("freelancer_id", "is_published", "sort_order");

-- CreateIndex
CREATE INDEX "freelancer_portfolio_items_file_object_id_idx" ON "freelancer_portfolio_items"("file_object_id");

-- CreateIndex
CREATE INDEX "freelancer_applications_organization_id_status_submitted_at_idx" ON "freelancer_applications"("organization_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "freelancer_applications_organization_id_primary_skill_idx" ON "freelancer_applications"("organization_id", "primary_skill");

-- CreateIndex
CREATE INDEX "freelancer_applications_phone_idx" ON "freelancer_applications"("phone");

-- CreateIndex
CREATE INDEX "freelancer_applications_freelancer_id_idx" ON "freelancer_applications"("freelancer_id");

-- CreateIndex
CREATE INDEX "freelancer_connections_organization_id_status_created_at_idx" ON "freelancer_connections"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "freelancer_connections_freelancer_id_status_idx" ON "freelancer_connections"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_connections_project_id_status_idx" ON "freelancer_connections"("project_id", "status");

-- CreateIndex
CREATE INDEX "freelancer_connections_shoot_id_status_idx" ON "freelancer_connections"("shoot_id", "status");

-- Avoid duplicate open relationships while preserving declined/expired history.
CREATE UNIQUE INDEX "freelancer_connections_one_active_context"
ON "freelancer_connections" (
    "organization_id",
    "freelancer_id",
    COALESCE("project_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("shoot_id", '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE "status" IN ('INTERESTED', 'CONTACTED', 'ACCEPTED', 'ASSIGNED');

-- AddForeignKey
ALTER TABLE "freelancer_plans" ADD CONSTRAINT "freelancer_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_subscriptions" ADD CONSTRAINT "freelancer_subscriptions_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_subscriptions" ADD CONSTRAINT "freelancer_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "freelancer_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_availability" ADD CONSTRAINT "freelancer_availability_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_portfolio_items" ADD CONSTRAINT "freelancer_portfolio_items_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_portfolio_items" ADD CONSTRAINT "freelancer_portfolio_items_file_object_id_fkey" FOREIGN KEY ("file_object_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_applications" ADD CONSTRAINT "freelancer_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_applications" ADD CONSTRAINT "freelancer_applications_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_applications" ADD CONSTRAINT "freelancer_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_connections" ADD CONSTRAINT "freelancer_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_connections" ADD CONSTRAINT "freelancer_connections_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_connections" ADD CONSTRAINT "freelancer_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_connections" ADD CONSTRAINT "freelancer_connections_shoot_id_fkey" FOREIGN KEY ("shoot_id") REFERENCES "shoots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_connections" ADD CONSTRAINT "freelancer_connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

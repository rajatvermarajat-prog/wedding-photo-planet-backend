ALTER TYPE "FreelancerApplicationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "FreelancerApplicationStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "FreelancerApplicationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "FreelancerApplicationStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "freelancer_id" UUID;
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "whatsapp" VARCHAR(32);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "city" VARCHAR(80);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "primary_skill" "CrewRole" NOT NULL DEFAULT 'LEAD_PHOTOGRAPHER';
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "experience_years" INTEGER;
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "portfolio_url" VARCHAR(1024);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "expected_rate" DECIMAL(14,2);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "rate_type" "RateType" NOT NULL DEFAULT 'PER_DAY';
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(6) DEFAULT now();
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "reviewed_by_id" UUID;
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "rejection_reason" VARCHAR(500);
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "freelancer_applications" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE "freelancer_applications" ALTER COLUMN "email" DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'freelancer_applications'
      AND column_name = 'freelancer_type'
  ) THEN
    ALTER TABLE "freelancer_applications" ALTER COLUMN "freelancer_type" SET DEFAULT 'LEAD_PHOTOGRAPHER';
  END IF;
END $$;

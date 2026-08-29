-- CreateTable
CREATE TABLE "personal_todos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "due_date" DATE,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "personal_todos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_todos_user_id_completed_idx" ON "personal_todos"("user_id", "completed");

-- CreateIndex
CREATE INDEX "personal_todos_organization_id_user_id_idx" ON "personal_todos"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

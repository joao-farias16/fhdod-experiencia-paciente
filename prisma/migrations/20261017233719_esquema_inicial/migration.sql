-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('superadmin', 'sector_admin', 'management', 'ombudsman', 'viewer');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('nps', 'scale_1_5');

-- CreateEnum
CREATE TYPE "response_origin" AS ENUM ('qr_code', 'link');

-- CreateEnum
CREATE TYPE "attribution_status" AS ENUM ('attributed', 'not_qr_origin', 'no_shift', 'ambiguous');

-- CreateEnum
CREATE TYPE "shift_period" AS ENUM ('morning', 'afternoon', 'night');

-- CreateEnum
CREATE TYPE "shift_source" AS ENUM ('manual', 'import');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('validated', 'rejected', 'committed');

-- CreateEnum
CREATE TYPE "manifestation_type" AS ENUM ('compliment', 'complaint', 'suggestion');

-- CreateEnum
CREATE TYPE "manifestation_status" AS ENUM ('received', 'in_review', 'forwarded', 'resolved', 'archived');

-- CreateEnum
CREATE TYPE "manifestation_priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "manifestation_event_kind" AS ENUM ('created', 'status_changed', 'priority_changed', 'actions_updated', 'note', 'contact_deleted');

-- CreateTable
CREATE TABLE "hospitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(160) NOT NULL,
    "short_name" VARCHAR(30) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospital_id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "user_role" NOT NULL,
    "all_sectors" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "deactivated_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospital_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_sectors" (
    "profile_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_sectors_pkey" PRIMARY KEY ("profile_id","sector_id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sector_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sector_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "period" "shift_period" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "shift_source" NOT NULL,
    "import_id" UUID,
    "created_by" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploaded_by" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "status" "import_status" NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "accepted_rows" INTEGER NOT NULL,
    "rejected_rows" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "staged_rows" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "committed_at" TIMESTAMPTZ(3),
    "committed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sector_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "intro_text" VARCHAR(500),
    "thank_you_message" VARCHAR(500) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "current_version_id" UUID,
    "has_unpublished_changes" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospital_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "survey_config_id" UUID NOT NULL,
    "journey_stage_id" UUID,
    "type" "question_type" NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "is_required" BOOLEAN NOT NULL,
    "position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "first_published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "survey_config_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "intro_text" VARCHAR(500),
    "thank_you_message" VARCHAR(500) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID NOT NULL,
    "superseded_at" TIMESTAMPTZ(3),

    CONSTRAINT "survey_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_version_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "survey_version_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "type" "question_type" NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "journey_stage_id" UUID,
    "journey_stage_name" VARCHAR(80),
    "journey_stage_position" SMALLINT,
    "position" SMALLINT NOT NULL,
    "is_required" BOOLEAN NOT NULL,

    CONSTRAINT "survey_version_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "survey_version_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "origin" "response_origin" NOT NULL,
    "nps_score" SMALLINT NOT NULL,
    "low_score" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attribution_status" "attribution_status" NOT NULL,
    "shift_id" UUID,
    "team_id" UUID,
    "shift_period" "shift_period",
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "manifestation_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "manifestation_token_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "survey_version_id" UUID NOT NULL,
    "survey_version_question_id" UUID NOT NULL,
    "question_type" "question_type" NOT NULL,
    "score" SMALLINT NOT NULL,

    CONSTRAINT "response_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifestations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "protocol" VARCHAR(15) NOT NULL DEFAULT next_manifestation_protocol(),
    "response_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "type" "manifestation_type" NOT NULL,
    "description" TEXT NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "triggered_by_low_score" BOOLEAN NOT NULL,
    "status" "manifestation_status" NOT NULL DEFAULT 'received',
    "priority" "manifestation_priority" NOT NULL DEFAULT 'medium',
    "actions_taken" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "updated_by" UUID,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifestation_contacts" (
    "manifestation_id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(11),
    "email" VARCHAR(254),
    "consent_given_at" TIMESTAMPTZ(3) NOT NULL,
    "purpose_text_version" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifestation_contacts_pkey" PRIMARY KEY ("manifestation_id")
);

-- CreateTable
CREATE TABLE "manifestation_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "manifestation_id" UUID NOT NULL,
    "author_id" UUID,
    "kind" "manifestation_event_kind" NOT NULL,
    "content" TEXT,
    "from_value" VARCHAR(30),
    "to_value" VARCHAR(30),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifestation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_profile_id" UUID,
    "actor_role" "user_role",
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(64),
    "sector_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "request_id" UUID,
    "ip_hash" CHAR(64),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_short_name_key" ON "hospitals"("short_name");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_auth_user_id_key" ON "profiles"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "profiles_hospital_id_idx" ON "profiles"("hospital_id");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_hospital_id_code_key" ON "sectors"("hospital_id", "code");

-- CreateIndex
CREATE INDEX "profile_sectors_sector_id_idx" ON "profile_sectors"("sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_sector_id_code_key" ON "teams"("sector_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_sector_id_key" ON "teams"("id", "sector_id");

-- CreateIndex
CREATE INDEX "shifts_sector_id_starts_at_ends_at_idx" ON "shifts"("sector_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "shifts_import_id_idx" ON "shifts"("import_id");

-- CreateIndex
CREATE INDEX "shift_imports_uploaded_by_created_at_idx" ON "shift_imports"("uploaded_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "survey_configs_slug_key" ON "survey_configs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "survey_configs_current_version_id_key" ON "survey_configs"("current_version_id");

-- CreateIndex
CREATE INDEX "survey_configs_sector_id_idx" ON "survey_configs"("sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_configs_id_sector_id_key" ON "survey_configs"("id", "sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "journey_stages_hospital_id_code_key" ON "journey_stages"("hospital_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journey_stages_hospital_id_position_key" ON "journey_stages"("hospital_id", "position");

-- CreateIndex
CREATE INDEX "questions_survey_config_id_position_idx" ON "questions"("survey_config_id", "position");

-- CreateIndex
CREATE INDEX "questions_journey_stage_id_idx" ON "questions"("journey_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_one_nps_per_survey_key" ON "questions"("survey_config_id") WHERE (type = 'nps'::question_type);

-- CreateIndex
CREATE UNIQUE INDEX "survey_versions_survey_config_id_version_number_key" ON "survey_versions"("survey_config_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "survey_versions_id_sector_id_key" ON "survey_versions"("id", "sector_id");

-- CreateIndex
CREATE INDEX "survey_version_questions_question_id_idx" ON "survey_version_questions"("question_id");

-- CreateIndex
CREATE INDEX "survey_version_questions_journey_stage_id_idx" ON "survey_version_questions"("journey_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_version_questions_version_question_key" ON "survey_version_questions"("survey_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_version_questions_version_position_key" ON "survey_version_questions"("survey_version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "survey_version_questions_id_version_type_key" ON "survey_version_questions"("id", "survey_version_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "survey_version_questions_one_nps_per_version_key" ON "survey_version_questions"("survey_version_id") WHERE (type = 'nps'::question_type);

-- CreateIndex
CREATE UNIQUE INDEX "responses_idempotency_key_key" ON "responses"("idempotency_key");

-- CreateIndex
CREATE INDEX "responses_submitted_at_idx" ON "responses"("submitted_at");

-- CreateIndex
CREATE INDEX "responses_sector_id_submitted_at_idx" ON "responses"("sector_id", "submitted_at");

-- CreateIndex
CREATE INDEX "responses_team_id_submitted_at_idx" ON "responses"("team_id", "submitted_at") WHERE (team_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "responses_shift_period_submitted_at_idx" ON "responses"("shift_period", "submitted_at") WHERE (shift_period IS NOT NULL);

-- CreateIndex
CREATE INDEX "responses_shift_id_idx" ON "responses"("shift_id") WHERE (shift_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "responses_survey_version_id_idx" ON "responses"("survey_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "responses_id_survey_version_id_key" ON "responses"("id", "survey_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "responses_id_sector_id_key" ON "responses"("id", "sector_id");

-- CreateIndex
CREATE INDEX "response_answers_survey_version_question_id_idx" ON "response_answers"("survey_version_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "response_answers_response_question_key" ON "response_answers"("response_id", "survey_version_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifestations_protocol_key" ON "manifestations"("protocol");

-- CreateIndex
CREATE UNIQUE INDEX "manifestations_response_id_key" ON "manifestations"("response_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifestations_idempotency_key_key" ON "manifestations"("idempotency_key");

-- CreateIndex
CREATE INDEX "manifestations_status_received_at_idx" ON "manifestations"("status", "received_at");

-- CreateIndex
CREATE INDEX "manifestations_sector_id_received_at_idx" ON "manifestations"("sector_id", "received_at");

-- CreateIndex
CREATE INDEX "manifestations_type_idx" ON "manifestations"("type");

-- CreateIndex
CREATE INDEX "manifestations_priority_idx" ON "manifestations"("priority");

-- CreateIndex
CREATE INDEX "manifestations_received_at_idx" ON "manifestations"("received_at");

-- CreateIndex
CREATE INDEX "manifestation_notes_manifestation_id_created_at_idx" ON "manifestation_notes"("manifestation_id", "created_at");

-- CreateIndex
CREATE INDEX "manifestation_notes_author_id_idx" ON "manifestation_notes"("author_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_profile_id_occurred_at_idx" ON "audit_logs"("actor_profile_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_sector_id_idx" ON "audit_logs"("sector_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_sectors" ADD CONSTRAINT "profile_sectors_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_sectors" ADD CONSTRAINT "profile_sectors_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_sectors" ADD CONSTRAINT "profile_sectors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_team_id_sector_id_fkey" FOREIGN KEY ("team_id", "sector_id") REFERENCES "teams"("id", "sector_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "shift_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_imports" ADD CONSTRAINT "shift_imports_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_imports" ADD CONSTRAINT "shift_imports_committed_by_fkey" FOREIGN KEY ("committed_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_configs" ADD CONSTRAINT "survey_configs_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_configs" ADD CONSTRAINT "survey_configs_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_configs" ADD CONSTRAINT "survey_configs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_configs" ADD CONSTRAINT "survey_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_stages" ADD CONSTRAINT "journey_stages_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_survey_config_id_fkey" FOREIGN KEY ("survey_config_id") REFERENCES "survey_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_journey_stage_id_fkey" FOREIGN KEY ("journey_stage_id") REFERENCES "journey_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_versions" ADD CONSTRAINT "survey_versions_survey_config_id_sector_id_fkey" FOREIGN KEY ("survey_config_id", "sector_id") REFERENCES "survey_configs"("id", "sector_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_versions" ADD CONSTRAINT "survey_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_version_questions" ADD CONSTRAINT "survey_version_questions_survey_version_id_fkey" FOREIGN KEY ("survey_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_version_questions" ADD CONSTRAINT "survey_version_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_version_questions" ADD CONSTRAINT "survey_version_questions_journey_stage_id_fkey" FOREIGN KEY ("journey_stage_id") REFERENCES "journey_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_survey_version_id_sector_id_fkey" FOREIGN KEY ("survey_version_id", "sector_id") REFERENCES "survey_versions"("id", "sector_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_team_id_sector_id_fkey" FOREIGN KEY ("team_id", "sector_id") REFERENCES "teams"("id", "sector_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_response_id_survey_version_id_fkey" FOREIGN KEY ("response_id", "survey_version_id") REFERENCES "responses"("id", "survey_version_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_svq_version_type_fkey" FOREIGN KEY ("survey_version_question_id", "survey_version_id", "question_type") REFERENCES "survey_version_questions"("id", "survey_version_id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestations" ADD CONSTRAINT "manifestations_response_id_sector_id_fkey" FOREIGN KEY ("response_id", "sector_id") REFERENCES "responses"("id", "sector_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestations" ADD CONSTRAINT "manifestations_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestations" ADD CONSTRAINT "manifestations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestation_contacts" ADD CONSTRAINT "manifestation_contacts_manifestation_id_fkey" FOREIGN KEY ("manifestation_id") REFERENCES "manifestations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestation_notes" ADD CONSTRAINT "manifestation_notes_manifestation_id_fkey" FOREIGN KEY ("manifestation_id") REFERENCES "manifestations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestation_notes" ADD CONSTRAINT "manifestation_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

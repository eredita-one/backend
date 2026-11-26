-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StaffApp" AS ENUM ('ADMIN', 'CONSULTOR', 'CONTABIL');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_profiles" (
    "id" UUID NOT NULL,
    "app" "StaffApp" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_profile_permissions" (
    "profile_id" UUID NOT NULL,
    "permission" VARCHAR(80) NOT NULL,

    CONSTRAINT "access_profile_permissions_pkey" PRIMARY KEY ("profile_id","permission")
);

-- CreateTable
CREATE TABLE "user_access_profiles" (
    "user_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_access_profiles_pkey" PRIMARY KEY ("user_id","profile_id")
);

-- CreateTable
CREATE TABLE "access_audit_log" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "actor_id" UUID,
    "subject_type" VARCHAR(30) NOT NULL,
    "subject_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "app" "StaffApp" NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" VARCHAR(255),
    "ip" VARCHAR(45),

    CONSTRAINT "user_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_accounts" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_refresh_tokens" (
    "id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" VARCHAR(255),
    "ip" VARCHAR(45),

    CONSTRAINT "client_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "access_profiles_app_name_key" ON "access_profiles"("app", "name");

-- CreateIndex
CREATE INDEX "user_access_profiles_profile_id_idx" ON "user_access_profiles"("profile_id");

-- CreateIndex
CREATE INDEX "access_audit_log_subject_type_subject_id_idx" ON "access_audit_log"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "access_audit_log_occurred_at_idx" ON "access_audit_log"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_refresh_tokens_token_hash_key" ON "user_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_refresh_tokens_family_id_idx" ON "user_refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "user_refresh_tokens_user_id_idx" ON "user_refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_email_key" ON "client_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "client_refresh_tokens_token_hash_key" ON "client_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "client_refresh_tokens_family_id_idx" ON "client_refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "client_refresh_tokens_client_account_id_idx" ON "client_refresh_tokens"("client_account_id");

-- AddForeignKey
ALTER TABLE "access_profile_permissions" ADD CONSTRAINT "access_profile_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "access_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_profiles" ADD CONSTRAINT "user_access_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_profiles" ADD CONSTRAINT "user_access_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "access_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_refresh_tokens" ADD CONSTRAINT "client_refresh_tokens_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "client_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- E-mail sempre minúsculo: no Postgres o índice único diferencia maiúsculas, então
-- "Ana@x.com" e "ana@x.com" seriam contas diferentes. A aplicação já normaliza; o banco garante.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_email_lowercase" CHECK ("email" = lower("email"));

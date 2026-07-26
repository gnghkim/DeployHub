CREATE TYPE "public"."draft_source_type" AS ENUM('cli', 'manual');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'validation_failed', 'pending_review', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."submitter_type" AS ENUM('token', 'user');--> statement-breakpoint
CREATE TABLE "project_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"manifest_version" text NOT NULL,
	"manifest_yaml" text NOT NULL,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_type" "draft_source_type" NOT NULL,
	"submitted_by_type" "submitter_type" NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"validation_result" jsonb,
	"diff" jsonb,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"repository_constraint" text,
	"project_slug_constraint" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "registration_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "project_drafts" ADD CONSTRAINT "project_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drafts" ADD CONSTRAINT "project_drafts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."snapshot_attempt_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."snapshot_mode" AS ENUM('disabled', 'automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TABLE "project_snapshots" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"image_data" "bytea",
	"content_type" text,
	"width" integer,
	"height" integer,
	"source" "snapshot_source",
	"source_url" text,
	"deployment_id" uuid,
	"checksum" text,
	"captured_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_attempt_status" "snapshot_attempt_status",
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "snapshot_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "snapshot_mode" "snapshot_mode" DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_unique" ON "jobs" USING btree ("type","dedupe_key") WHERE "jobs"."dedupe_key" IS NOT NULL AND "jobs"."status" IN ('pending', 'running');
CREATE TYPE "public"."change_event_kind" AS ENUM('health_status', 'container_status', 'container_health', 'deployment', 'ssl_expiry', 'sync_failure');--> statement-breakpoint
CREATE TYPE "public"."event_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "change_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid,
	"component_id" uuid,
	"resource_id" uuid,
	"kind" "change_event_kind" NOT NULL,
	"severity" "event_severity" NOT NULL,
	"previous_value" text,
	"current_value" text NOT NULL,
	"detail" text NOT NULL,
	"notified_at" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_events_occurred_idx" ON "change_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "change_events_project_occurred_idx" ON "change_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "change_events_unnotified_idx" ON "change_events" USING btree ("notified_at","severity");
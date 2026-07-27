CREATE TABLE "container_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"cpu_pct" double precision NOT NULL,
	"mem_bytes" bigint NOT NULL,
	"restart_count" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"component_id" uuid,
	"provider" "provider_type" NOT NULL,
	"environment" text NOT NULL,
	"version" text,
	"commit_sha" text,
	"image_name" text,
	"external_deployment_id" text NOT NULL,
	"status" text NOT NULL,
	"deployment_url" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_provider_external_deployment_unique" UNIQUE("provider","external_deployment_id")
);
--> statement-breakpoint
ALTER TABLE "container_snapshots" ADD CONSTRAINT "container_snapshots_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "container_snapshots_resource_observed_idx" ON "container_snapshots" USING btree ("resource_id","observed_at");
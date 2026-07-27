ALTER TABLE "components" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "container_name" text;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "url" text;--> statement-breakpoint
CREATE INDEX "components_provider_external_ref_idx" ON "components" USING btree ("provider","external_ref");--> statement-breakpoint
CREATE INDEX "components_container_name_idx" ON "components" USING btree ("container_name");
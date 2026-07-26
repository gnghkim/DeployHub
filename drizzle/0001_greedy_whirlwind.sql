ALTER TABLE "projects" ADD COLUMN "repository" text;--> statement-breakpoint
CREATE INDEX "projects_repository_idx" ON "projects" USING btree ("repository");
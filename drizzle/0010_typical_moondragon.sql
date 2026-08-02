ALTER TABLE "jobs" ADD COLUMN "trailing_payload" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "trailing_max_attempts" integer;
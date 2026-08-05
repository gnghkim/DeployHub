ALTER TABLE "projects" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY name) - 1 AS position FROM projects
)
UPDATE projects SET display_order = ordered.position
FROM ordered WHERE projects.id = ordered.id;

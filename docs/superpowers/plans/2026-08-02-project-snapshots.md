# Project Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one current project snapshot that can be refreshed automatically after a newly observed successful production deployment or pinned by an authenticated manual upload, and show it to the right of project information on expanded list cards.

**Architecture:** PostgreSQL stores project snapshot settings, the current normalized WebP, and the latest attempt state. The existing worker schedules one active capture job per project and calls an isolated Playwright `snapshotter` service. Authenticated Next.js routes manage settings, uploads, actions, and private image delivery; list queries fetch metadata only and lazy-load image bytes from the private endpoint.

**Tech Stack:** Next.js 16 App Router, React 19, PostgreSQL 17, Drizzle ORM, Vitest/Testcontainers, worker jobs, Node.js 22, Playwright 1.62.0, Chromium, sharp 0.35.3, Docker Compose.

---

## Implementation rules

- Run every command from the repository root.
- Follow TDD in each task: add the named failing test, run it and observe the expected failure, implement only enough production code, then rerun the focused test.
- Do not expose snapshot image bytes through list/detail queries. They are served only by the authenticated image route.
- Store `snapshot.capture` jobs with `dedupeKey = snapshot:<projectId>`. The payload still records `deploymentId` or a generated `requestId`; the project-scoped key is the stronger guarantee that only one pending/running capture exists per project.
- Treat only Docker `running` and Vercel `READY` deployments in the `production` environment as successful automatic triggers. Comparisons are case-normalized, but no other provider/status is guessed.
- Never save login credentials, cookies, browser profiles, page content, target response bodies, or secret-bearing URLs.
- Before changing `deployhub.yaml`, build and use the repository CLI as required by `AGENTS.md`; do not invent provider/type values.

## Task 1: Add snapshot persistence and concurrency-safe job deduplication

**Files:**

- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/projects.ts`
- Modify: `packages/db/src/schema/jobs.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/jobs/types.ts`
- Modify: `packages/db/src/jobs/queue.ts`
- Modify: `packages/db/src/jobs/queue.test.ts`
- Modify: `packages/db/src/schema/schema.test.ts`
- Modify: `packages/db/src/schema/migrations.test.ts`
- Create: `drizzle/0009_project_snapshots.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: the Drizzle-generated `drizzle/meta/0009_snapshot.json`

- [ ] Add failing queue tests proving that the same `(type, dedupeKey)` cannot coexist while pending/running, a different project key can coexist, a completed job releases the key, and calls without a key retain global-by-type behavior.

```ts
await expect(enqueueUnique(db, {
  type: 'snapshot.capture',
  dedupeKey: `snapshot:${projectA.id}`,
})).resolves.toBe(true);
await expect(enqueueUnique(db, {
  type: 'snapshot.capture',
  dedupeKey: `snapshot:${projectA.id}`,
})).resolves.toBe(false);
await expect(enqueueUnique(db, {
  type: 'snapshot.capture',
  dedupeKey: `snapshot:${projectB.id}`,
})).resolves.toBe(true);
```

- [ ] Add schema tests for the three enums, project fields, one-to-one snapshot primary key, cascade delete, and nullable deployment foreign key.
- [ ] Run the focused tests and confirm they fail because `dedupeKey`, snapshot enums, and `projectSnapshots` do not exist.

```powershell
pnpm vitest run packages/db/src/jobs/queue.test.ts packages/db/src/schema/schema.test.ts
```

Expected: TypeScript/runtime assertions fail on the missing schema and queue behavior.

- [ ] Add these enums to `packages/db/src/schema/enums.ts`.

```ts
export const snapshotMode = pgEnum('snapshot_mode', [
  'disabled', 'automatic', 'manual',
]);
export const snapshotSource = pgEnum('snapshot_source', [
  'automatic', 'manual',
]);
export const snapshotAttemptStatus = pgEnum('snapshot_attempt_status', [
  'pending', 'success', 'failed',
]);
```

- [ ] Add `snapshotUrl: text('snapshot_url')` and `snapshotMode: snapshotMode('snapshot_mode').notNull().default('disabled')` to `projects`, then define and export `projectSnapshots` with the exact columns from the approved design. Use Drizzle's native `bytea('image_data')`, a `projectId` primary key with cascade delete, and a nullable `deploymentId` with `onDelete: 'set null'`.
- [ ] Add `dedupeKey: text('dedupe_key')` to `jobs` and an active partial unique index on `(type, dedupeKey)` for non-null keys whose status is pending/running.
- [ ] Extend `EnqueueOptions` with `dedupeKey?: string`. In `enqueueUnique`, persist `options.dedupeKey ?? '__global__'` and use `INSERT ... ON CONFLICT ... DO NOTHING` against the active partial unique index. Keep `enqueue` non-unique and store its optional key when supplied.
- [ ] Generate the migration, rename only the generated SQL file to `0009_project_snapshots.sql` if necessary, and inspect the generated SQL and metadata rather than hand-writing schema guesses.

```powershell
pnpm --filter @deployhub/db exec drizzle-kit generate --name project_snapshots
```

- [ ] Add a migration test that checks the generated migration contains all enum/table/column/index/FK statements and contains no destructive `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` statement.
- [ ] Run the database tests.

```powershell
pnpm vitest run packages/db/src/jobs/queue.test.ts packages/db/src/schema/schema.test.ts packages/db/src/schema/migrations.test.ts
```

Expected: PASS.

- [ ] Commit the database foundation.

```powershell
git add packages/db/src drizzle
git commit -m "feat: add project snapshot persistence"
```

## Task 2: Add snapshot repository operations without loading blobs into summaries

**Files:**

- Create: `packages/db/src/queries/project-snapshots.ts`
- Create: `packages/db/src/queries/project-snapshots.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/queries/projects.ts`
- Modify: `packages/db/src/queries/projects.test.ts`

- [ ] Write failing repository tests for: marking an attempt pending; saving an automatic success; preserving the current image on failure; replacing it with a manual upload and switching the project to manual mode in one transaction; resuming automatic mode without clearing the manual image; deleting only image/success metadata; and cascade deletion.
- [ ] Write a failing project summary test that inserts a blob but expects only this metadata on `ProjectListSummaryData`:

```ts
snapshot: {
  hasImage: true,
  source: 'manual',
  capturedAt: expect.any(Date),
  lastAttemptStatus: 'success',
} as const
```

- [ ] Run the focused tests and confirm failures.

```powershell
pnpm vitest run packages/db/src/queries/project-snapshots.test.ts packages/db/src/queries/projects.test.ts
```

- [ ] Implement typed functions in `project-snapshots.ts`:

```ts
export async function getSnapshotState(db: Db, projectId: string): Promise<ProjectSnapshotState | undefined>;
export async function markSnapshotPending(db: Db, projectId: string): Promise<void>;
export async function saveAutomaticSnapshot(db: Db, input: AutomaticSnapshotInput): Promise<boolean>;
export async function saveManualSnapshot(db: Db, input: ManualSnapshotInput): Promise<void>;
export async function markSnapshotFailed(db: Db, projectId: string, errorCode: SnapshotErrorCode): Promise<void>;
export async function resumeAutomaticSnapshot(db: Db, projectId: string): Promise<void>;
export async function deleteSnapshotImage(db: Db, projectId: string): Promise<void>;
```

`saveAutomaticSnapshot` must lock/read the project inside the transaction and return `false` without changing the row unless the project is still `automatic` and its current `snapshotUrl` exactly matches the job URL. Failure updates only attempt fields. Delete clears `imageData`, content metadata, source metadata, checksum, and `capturedAt`, but does not change project mode.

- [ ] Add a fifth bounded follow-up query in `listProjectsWithSummaryData` that selects only `projectId`, a boolean expression for `imageData IS NOT NULL`, source, captured time, and attempt status. Update the query-count comment from five total to six total. Never select `imageData` itself.
- [ ] Export the query module and rerun focused tests.

```powershell
pnpm vitest run packages/db/src/queries/project-snapshots.test.ts packages/db/src/queries/projects.test.ts
```

Expected: PASS.

- [ ] Commit repository behavior.

```powershell
git add packages/db/src
git commit -m "feat: add project snapshot queries"
```

## Task 3: Build the isolated snapshotter application

**Files:**

- Create: `apps/snapshotter/package.json`
- Create: `apps/snapshotter/tsconfig.json`
- Create: `apps/snapshotter/tsup.config.ts`
- Create: `apps/snapshotter/src/errors.ts`
- Create: `apps/snapshotter/src/url-policy.ts`
- Create: `apps/snapshotter/src/url-policy.test.ts`
- Create: `apps/snapshotter/src/capture.ts`
- Create: `apps/snapshotter/src/capture.test.ts`
- Create: `apps/snapshotter/src/server.ts`
- Create: `apps/snapshotter/src/server.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] Add a private workspace app with pinned runtime dependencies `playwright: 1.62.0` and `sharp: 0.35.3`, build/typecheck scripts matching the worker, and a `tsup` Node ESM entry at `src/server.ts`.
- [ ] Write URL policy tests using an injected `dns.promises.Resolver` seam. Cover HTTP/HTTPS acceptance; userinfo and non-80/443 port rejection; localhost; IPv4 loopback/private/link-local/multicast/reserved/metadata; IPv4-mapped IPv6; IPv6 loopback/link-local/unique-local/multicast/reserved; mixed public/private DNS answers; redirect revalidation; and a maximum of five redirects.
- [ ] Run the policy tests and confirm they fail.

```powershell
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm vitest run apps/snapshotter/src/url-policy.test.ts
```

Expected: FAIL because the policy module is not implemented.

- [ ] Implement `validatePublicHttpUrl(url, resolver)` so every resolved address must be public, the protocol is HTTP(S), the effective port is 80/443, and credentials are absent. Return a normalized URL or throw one of the approved public error codes.

```ts
export type SnapshotErrorCode =
  | 'timeout'
  | 'blocked_target'
  | 'navigation_failed'
  | 'render_failed'
  | 'image_too_large';
```

- [ ] Write capture tests against injected browser/page fakes. Assert viewport `1440x900`, a fresh incognito context, no persistent profile, `waitUntil: 'domcontentloaded'`, a short post-load settle bounded by the overall 20-second timeout, request/redirect validation, WebP output, and the 1.5 MB response cap.
- [ ] Implement `captureSnapshot` with `page.route('**/*')` validation before each network request, redirect target validation, `ignoreHTTPSErrors: false`, no downloaded files or extensions, PNG screenshot followed by sharp WebP normalization, and `finally` cleanup of page/context/browser. Do not log target URLs or page data.
- [ ] Write server tests for only `POST /capture`, JSON-body size limits, fixed viewport acceptance, response content type/dimensions, normalized error JSON, and non-POST/unknown path rejection. Inject `captureSnapshot` so server tests do not launch Chromium.
- [ ] Implement the Node HTTP server on internal port 3001. Cap request and response bodies, use an `AbortController` for the 20-second deadline, and log only request ID, duration, success/failure code.
- [ ] Run all snapshotter tests and typecheck.

```powershell
pnpm vitest run apps/snapshotter/src
pnpm --filter snapshotter typecheck
pnpm --filter snapshotter build
```

Expected: PASS.

- [ ] Commit the service.

```powershell
git add apps/snapshotter pnpm-lock.yaml
git commit -m "feat: add isolated snapshot capture service"
```

## Task 4: Secure the snapshotter container and Compose network boundary

**Files:**

- Create: `docker/Snapshotter.Dockerfile`
- Create: `docker/playwright-seccomp.json`
- Modify: `docker/compose.yml`
- Modify: `docker/README.md`
- Modify: `.env.example`
- Modify: `packages/shared/src/env.ts`
- Modify: `packages/shared/src/env.test.ts`

- [ ] Add a failing shared-env test expecting `SNAPSHOTTER_URL` to be optional outside Compose and preserved when set.
- [ ] Implement the env field and run its test.

```powershell
pnpm vitest run packages/shared/src/env.test.ts
```

Expected: PASS after the field is added.

- [ ] Create a multi-stage snapshotter image. Build with Node 22, copy only the bundled service into `mcr.microsoft.com/playwright:v1.62.0-noble`, keep the package version aligned with the image, and run as the image's non-root `pwuser`.
- [ ] Start from Docker's default seccomp profile and add only Playwright's documented `clone`, `setns`, and `unshare` allowances for the non-root Chromium sandbox. Do not use privileged mode or `--no-sandbox`.
- [ ] Add a `snapshotter` service with `container_name: deployhub-snapshotter`, no host `ports`, `init: true`, `shm_size: 1gb`, the seccomp file, healthcheck, and only the new `snapshot` network. Add that network to worker and set `SNAPSHOTTER_URL=http://snapshotter:3001`; do not attach snapshotter to `deployhub`, `docker-api`, or `web`.
- [ ] Add service labels using component name `snapshotter` and production environment. Document why the service has no database/socket access and why authenticated pages require manual upload.
- [ ] Validate the resolved Compose model, build the image, and inspect the security/network fields.

```powershell
docker compose --env-file .env -f docker/compose.yml config --quiet
docker compose --env-file .env -f docker/compose.yml build snapshotter
docker compose --env-file .env -f docker/compose.yml config | Select-String -Pattern 'snapshotter|snapshot:|seccomp|pwuser|3001'
```

Expected: config/build succeed; snapshotter has no published port and only the snapshot network.

- [ ] Commit container integration.

```powershell
git add docker .env.example packages/shared/src
git commit -m "feat: isolate snapshotter deployment"
```

## Task 5: Add the worker capture client and race-safe handler

**Files:**

- Create: `apps/worker/src/handlers/snapshot-capture.ts`
- Create: `apps/worker/src/handlers/snapshot-capture.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] Write failing handler tests for automatic success, disabled/manual no-op, missing URL no-op, URL changed while capturing, manual upload winning a race, timeout retry, permanent blocked-target failure without retry, transient navigation failure with retry, old image preservation, and response-size rejection.
- [ ] Use an injected `fetch` and a deferred promise in the race test. While fetch is pending, save a manual image; after resolving fetch, assert the manual checksum/source/image remain unchanged.
- [ ] Run the focused test and confirm failure.

```powershell
pnpm vitest run apps/worker/src/handlers/snapshot-capture.test.ts
```

- [ ] Implement payload parsing and the public enqueue helper:

```ts
export type SnapshotCapturePayload = {
  projectId: string;
  url: string;
  deploymentId?: string;
  requestId?: string;
};

export async function enqueueSnapshotCapture(
  db: Db,
  payload: SnapshotCapturePayload,
): Promise<boolean> {
  return enqueueUnique(db, {
    type: 'snapshot.capture',
    dedupeKey: `snapshot:${payload.projectId}`,
    payload,
    maxAttempts: 3,
  });
}
```

- [ ] The handler must re-read project mode/URL before marking pending, call snapshotter with a 20-second abort, enforce `image/webp` and 1.5 MB, calculate SHA-256 itself, then use the Task 2 compare-and-save transaction. Map only approved error codes into `lastError`. Permanent validation/size failures should record failed and return successfully; transient timeout/navigation/render/service errors should record failed and throw for the existing retry policy.
- [ ] Register `snapshot.capture` with `env.SNAPSHOTTER_URL`. If the URL is absent, the handler should record a safe `navigation_failed` state and throw without exposing configuration details.
- [ ] Run tests, typecheck, and build.

```powershell
pnpm vitest run apps/worker/src/handlers/snapshot-capture.test.ts apps/worker/src/runner.test.ts
pnpm --filter worker typecheck
pnpm --filter worker build
```

Expected: PASS.

- [ ] Commit worker capture execution.

```powershell
git add apps/worker/src
git commit -m "feat: process project snapshot jobs"
```

## Task 6: Enqueue automatic captures only for newly observed successful production deployments

**Files:**

- Modify: `packages/db/src/queries/observations.ts`
- Modify: `packages/db/src/queries/observations.test.ts`
- Modify: `apps/worker/src/handlers/docker-sync.ts`
- Modify: `apps/worker/src/handlers/docker-sync.test.ts`
- Modify: `apps/worker/src/handlers/vercel-sync.ts`
- Modify: `apps/worker/src/handlers/vercel-sync.test.ts`

- [ ] Change the deployment repository test first so `upsertDeployment` returns `{ id, inserted }`, with `inserted: true` on first insert and `false` on an update of the same provider/external ID.
- [ ] Implement the upsert as `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, followed by an explicit update when no row was inserted. Do not use the PostgreSQL `xmax` implementation detail.
- [ ] Add Docker and Vercel sync tests proving:

```text
new + production + docker running + automatic URL => one snapshot.capture job
new + production + Vercel READY + automatic URL => one snapshot.capture job
existing deployment status update => no new capture job
preview/non-production deployment => no capture job
failed/building/stopped deployment => no capture job
manual/disabled/missing URL project => no capture job
two new deployments for one project in one sync => one active project job
```

- [ ] Run all three focused suites and confirm the new assertions fail.

```powershell
pnpm vitest run packages/db/src/queries/observations.test.ts apps/worker/src/handlers/docker-sync.test.ts apps/worker/src/handlers/vercel-sync.test.ts
```

- [ ] Replace both inline deployment upserts with `upsertDeployment`. Collect newly inserted capture candidates during the provider transaction, then call `enqueueSnapshotCapture` only after the transaction commits. This prevents a capture job from observing rolled-back deployment/link state; the queue dedupe protects repeated syncs.
- [ ] Add and use this exact provider-aware predicate in a shared worker-local helper:

```ts
export function isSuccessfulProductionDeployment(input: {
  provider: 'docker' | 'vercel';
  environment: string;
  status: string;
}): boolean {
  if (input.environment.toLowerCase() !== 'production') return false;
  const status = input.status.toUpperCase();
  return input.provider === 'docker' ? status === 'RUNNING' : status === 'READY';
}
```

- [ ] Rerun tests and worker verification.

```powershell
pnpm vitest run packages/db/src/queries/observations.test.ts apps/worker/src/handlers/docker-sync.test.ts apps/worker/src/handlers/vercel-sync.test.ts
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] Commit automatic triggering.

```powershell
git add packages/db/src apps/worker/src
git commit -m "feat: capture new successful deployments"
```

## Task 7: Add authenticated snapshot settings, upload, action, and image routes

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/lib/snapshot-upload.ts`
- Create: `apps/web/src/lib/snapshot-upload.test.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/route.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/upload/route.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/capture/route.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/resume/route.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/settings/route.ts`
- Create: `apps/web/src/app/api/projects/[slug]/snapshot/routes.test.ts`

- [ ] Add `sharp: 0.35.3` to web runtime dependencies and install with the lockfile.
- [ ] Write upload-normalization tests for valid PNG/JPEG/WebP, forged MIME/signature mismatch, undecodable data, non-image input, 5 MB input overflow, WebP output at 1440x900 with `fit: 'contain'` and a dark neutral background, stripped metadata, and 1.5 MB normalized output overflow.
- [ ] Implement `normalizeSnapshotUpload(file)` using sharp decode metadata rather than trusting the extension/MIME alone. Return `{ imageData, contentType: 'image/webp', width: 1440, height: 900, checksum }`.
- [ ] Run the upload test.

```powershell
pnpm vitest run apps/web/src/lib/snapshot-upload.test.ts
```

Expected: PASS after implementation.

- [ ] Write route tests with injected `db`, `auth`, normalizer, and enqueuer. Every route must return 401 without a session and 404 for an unknown slug. Cover:

```text
GET snapshot: 200 image/webp + Cache-Control private + quoted checksum ETag
GET snapshot with If-None-Match: 304 and no body
GET missing image: 404
DELETE snapshot: clears image only
POST upload: multipart normalization + atomic manual pin
POST capture: automatic mode only + request UUID payload
POST resume: automatic mode + immediate enqueue while old image remains
POST settings: disabled or automatic; automatic requires validated public HTTP(S) URL
```

- [ ] Implement handler factories for tests and thin App Router exports that call `auth()` from `@/auth/config`. Settings URL validation should enforce syntax/protocol/userinfo/port immediately; snapshotter remains authoritative for DNS/SSRF validation.
- [ ] Use `revalidatePath('/')` and `revalidatePath('/projects/[slug]', 'page')` after mutations. Never add these routes to the middleware public allowlist.
- [ ] Run route tests, middleware regression, typecheck, and Next build.

```powershell
pnpm vitest run apps/web/src/app/api/projects/[slug]/snapshot/routes.test.ts apps/web/src/middleware.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS.

- [ ] Commit private APIs.

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat: add private project snapshot APIs"
```

## Task 8: Add snapshot controls to project edit and detail pages

**Files:**

- Create: `apps/web/src/app/projects/[slug]/snapshot-settings-form.tsx`
- Create: `apps/web/src/app/projects/[slug]/snapshot-panel.tsx`
- Create: `apps/web/src/app/projects/[slug]/snapshot-panel.test.tsx`
- Modify: `apps/web/src/app/projects/[slug]/edit/page.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.test.ts`

- [ ] Write component/page tests first. Assert the edit page exposes representative URL and automatic toggle; the detail panel shows the current image, source, capture time, last failed attempt while preserving the image, and mode-appropriate controls.
- [ ] Assert the action matrix exactly:

```text
disabled: upload only; link to settings to enable automatic
automatic: capture now, upload, delete
manual: resume automatic, replace upload, delete
```

- [ ] Run the tests and confirm the missing UI fails.

```powershell
pnpm vitest run apps/web/src/app/projects/[slug]/snapshot-panel.test.tsx apps/web/src/app/projects/[slug]/page.test.ts
```

- [ ] Build accessible client controls that call the Task 7 routes, disable while pending, announce success/error with `aria-live`, and refresh the router on success. File input accepts only PNG/JPEG/WebP and states the 5 MB limit. Do not imply authenticated auto-capture is supported.
- [ ] Render `SnapshotSettingsForm` after the existing project form only on the edit page. Render `SnapshotPanel` in the detail page using snapshot metadata and the private image endpoint; append the checksum as a query value only to bust the browser cache after replacement.
- [ ] Rerun focused tests and web typecheck.

```powershell
pnpm vitest run apps/web/src/app/projects/[slug]/snapshot-panel.test.tsx apps/web/src/app/projects/[slug]/page.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] Commit management UI.

```powershell
git add apps/web/src/app/projects
git commit -m "feat: manage project snapshots"
```

## Task 9: Put information left and snapshots right on expanded project cards

**Files:**

- Modify: `apps/web/src/components/schematic/project-sheet.tsx`
- Modify: `apps/web/src/components/schematic/project-sheet.test.ts`
- Modify: `apps/web/src/components/schematic/project-sheet-render.test.ts`
- Modify: `apps/web/src/components/schematic/project-sheet-collapse.test.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/responsive-layout.test.ts`

- [ ] Add failing render tests that require: metadata on the left, snapshot at approximately 42% width on desktop, snapshot below metadata on mobile, `loading="lazy"`, an authenticated link to the full image, an empty-state/settings link, and an updating badge that does not hide the old image.
- [ ] Extend collapse tests to prove both information and snapshot bodies are removed from the accessibility/render tree while collapsed and only the project name/header remains visible.
- [ ] Run focused tests and confirm failure.

```powershell
pnpm vitest run apps/web/src/components/schematic/project-sheet.test.ts apps/web/src/components/schematic/project-sheet-render.test.ts apps/web/src/components/schematic/project-sheet-collapse.test.tsx apps/web/src/app/page.test.ts apps/web/src/app/responsive-layout.test.ts
```

- [ ] Refactor only the expanded card body to this responsive structure, retaining the current header/collapse state implementation:

```tsx
<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,42%)]">
  <ProjectInformation project={project} />
  <ProjectSnapshotPreview project={project} />
</div>
```

- [ ] Give the preview a 16:10 aspect ratio (`aspect-[16/10]`), `object-contain`, a neutral letterbox background, and clear source/time/status text. Clicking opens the authenticated image endpoint in a new tab with `rel="noreferrer"`.
- [ ] Rerun tests and web production build.

```powershell
pnpm vitest run apps/web/src/components/schematic/project-sheet.test.ts apps/web/src/components/schematic/project-sheet-render.test.ts apps/web/src/components/schematic/project-sheet-collapse.test.tsx apps/web/src/app/page.test.ts apps/web/src/app/responsive-layout.test.ts
pnpm --filter web build
```

Expected: PASS.

- [ ] Commit the card layout.

```powershell
git add apps/web/src/components/schematic apps/web/src/app
git commit -m "feat: show snapshots on project cards"
```

## Task 10: Document, register, and verify the complete deployment

**Files:**

- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `deployhub.yaml` only after CLI inspection validates the exact schema fields

- [ ] Update README architecture/features/version tables for snapshotter, Playwright 1.62.0, sharp 0.35.3, automatic/public-page behavior, and manual authenticated-page behavior. Update deployment docs with migration, image build, Compose startup, healthcheck, rollback, and storage/backup impact of PostgreSQL image blobs.
- [ ] Run the full local verification before touching the manifest.

```powershell
pnpm typecheck
pnpm test
pnpm --filter web build
pnpm --filter worker build
pnpm --filter snapshotter build
docker compose --env-file .env -f docker/compose.yml config --quiet
docker compose --env-file .env -f docker/compose.yml build web worker snapshotter
```

Expected: every command succeeds.

- [ ] Start PostgreSQL/migrations and the three runtime services in the test/deployment environment, then verify the real flow with a public fixture URL and a generated manual PNG/JPEG. Confirm automatic capture, manual pin, ignored subsequent auto result, resume, delete, private image 401, card layout, and collapsed name-only behavior. Do not use or store login cookies in snapshotter.
- [ ] Build the DeployHub CLI first, then run existing-project inspection with `DEPLOYHUB_TOKEN` supplied only through the environment. Do not echo it.

```powershell
pnpm --filter @deployhub/cli build
node packages/cli/dist/index.js status
node packages/cli/dist/index.js diff
node packages/cli/dist/index.js validate
```

- [ ] Inspect the first-line schema and CLI output. Add the `snapshotter` component only with fields the current schema accepts and evidence from `apps/snapshotter`, Dockerfile, and Compose. Use confirmed container `deployhub-snapshotter`; do not add a URL because no production HTTP URL is exposed. Then validate again.

```powershell
node packages/cli/dist/index.js validate
node packages/cli/dist/index.js diff
```

Expected: local validation succeeds and diff shows only the intended snapshotter/technical documentation changes.

- [ ] Submit a draft, record only the non-secret Draft URL in the handoff, and stop for human review/approval. Draft creation is not production approval.

```powershell
node packages/cli/dist/index.js sync --draft
```

- [ ] Run final repository verification after the manifest change.

```powershell
git diff --check
git status --short
pnpm typecheck
pnpm test
pnpm --filter web build
pnpm --filter worker build
pnpm --filter snapshotter build
docker compose --env-file .env -f docker/compose.yml config --quiet
```

Expected: all commands pass; only intended changes remain.

- [ ] Commit documentation and validated registration data.

```powershell
git add README.md docs/deployment.md deployhub.yaml
git commit -m "docs: register project snapshot service"
```

- [ ] Before claiming completion, use `superpowers:verification-before-completion`, review every acceptance criterion in `docs/superpowers/specs/2026-08-02-project-snapshots-design.md`, and report the tests/builds, Draft URL, migration/deployment order, and any remaining human approval step.

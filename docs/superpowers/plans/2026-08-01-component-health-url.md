# Component Health URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated component `healthUrl` that replaces same-origin root HTTP checks while preserving domain TLS checks, then register Yield's confirmed readiness endpoint.

**Architecture:** The canonical manifest schema owns the optional full HTTP(S) URL. Draft approval persists it on components, read APIs and diffing round-trip it, and the health worker chooses `healthUrl ?? url` while suppressing a duplicate same-origin domain root. Existing manifests remain unchanged because the new field and database column are nullable.

**Tech Stack:** TypeScript 6, Zod 4, Drizzle ORM/PostgreSQL, Next.js 16, Vitest 4, pnpm 9, YAML

---

## File map

- `packages/manifest/src/schema.ts`: canonical `healthUrl` validation and inferred TypeScript type.
- `packages/manifest/src/json-schema.ts`: public JSON Schema representation.
- `packages/manifest/src/diff.ts`: remote/local component comparison.
- `packages/db/src/schema/projects.ts`: nullable component persistence field.
- `drizzle/0008_component_health_url.sql`: forward migration.
- `drizzle/meta/0008_snapshot.json` and `drizzle/meta/_journal.json`: generated migration metadata.
- `apps/web/src/actions/drafts.ts`: approved Draft persistence.
- `apps/web/src/app/api/v1/projects/[slug]/manifest/route.ts`: approved manifest read contract.
- `packages/cli/src/api.ts`: CLI response validation for diff and sync.
- `apps/web/src/app/settings/drafts/[id]/page.tsx`: human review visibility.
- `apps/worker/src/handlers/health-check.ts`: effective target selection and same-origin suppression.
- `docs/project-registration.md`: operator-facing field documentation.
- `C:/Dev/Yield/deployhub.yaml`: post-deployment adoption of the readiness URL.

### Task 1: Add the manifest contract

**Files:**
- Modify: `packages/manifest/src/schema.test.ts`
- Modify: `packages/manifest/src/json-schema.test.ts`
- Modify: `packages/manifest/src/schema.ts`
- Modify: `packages/manifest/src/json-schema.ts`

- [ ] **Step 1: Write failing parser tests**

Add these assertions to `manifest component deployment declarations` in
`packages/manifest/src/schema.test.ts`:

```ts
it('accepts only absolute HTTP(S) health URLs', () => {
  expect(parseComponent({
    healthUrl: '  https://api.example.com/health/ready  ',
  }).healthUrl).toBe('https://api.example.com/health/ready');
  expect(parseComponent({
    healthUrl: 'http://localhost:3000/health',
  }).healthUrl).toBe('http://localhost:3000/health');

  for (const healthUrl of [
    '/health',
    'api.example.com/health',
    'ftp://api.example.com/health',
    'https://',
  ]) {
    expect(() => parseComponent({ healthUrl })).toThrow();
  }
});
```

- [ ] **Step 2: Write a failing JSON Schema test**

Extend the local `JsonSchema` type in
`packages/manifest/src/json-schema.test.ts`:

```ts
format?: string;
pattern?: string;
```

Then add:

```ts
it('exposes an absolute HTTP(S) health URL', () => {
  const schema = manifestJsonSchema() as JsonSchema;
  const healthUrl = property(
    property(property(schema, 'spec'), 'components').items!,
    'healthUrl',
  );

  expect(healthUrl.type).toBe('string');
  expect(healthUrl.format).toBe('uri');
  expect(healthUrl.pattern).toBe('^https?://');
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/manifest/src/schema.test.ts packages/manifest/src/json-schema.test.ts --reporter=verbose
```

Expected: FAIL because `healthUrl` is rejected as an unknown component key and
is absent from the JSON Schema.

- [ ] **Step 4: Implement strict full-URL validation**

Add this reusable schema before `componentSchema` in
`packages/manifest/src/schema.ts`:

```ts
const absoluteHttpUrl = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.hostname.length > 0
      );
    } catch {
      return false;
    }
  }, { message: 'Expected an absolute HTTP(S) URL' });
```

Add the optional component property without changing the legacy `url` rule:

```ts
healthUrl: absoluteHttpUrl.optional(),
```

Extend the existing `override` callback in
`packages/manifest/src/json-schema.ts`:

```ts
if (
  path.join('.') ===
  'properties.spec.properties.components.items.properties.healthUrl'
) {
  jsonSchema.type = 'string';
  jsonSchema.format = 'uri';
  jsonSchema.pattern = '^https?://';
}
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run the Step 3 command.

Expected: both files pass with the new parser and JSON Schema assertions.

- [ ] **Step 6: Commit the manifest contract**

```powershell
git add packages/manifest/src/schema.ts packages/manifest/src/schema.test.ts packages/manifest/src/json-schema.ts packages/manifest/src/json-schema.test.ts
git commit -m "feat(manifest): add component health URL"
```

### Task 2: Include health URLs in manifest diffs

**Files:**
- Modify: `packages/manifest/src/diff.test.ts`
- Modify: `packages/manifest/src/diff.ts`

- [ ] **Step 1: Write the failing diff test**

Add `healthUrl: null` to the component returned by the existing
`currentProject()` helper, then add:

```ts
it('reports a component health URL change', () => {
  const changedHealthUrl = manifest();
  changedHealthUrl.spec.components[0]!.healthUrl =
    'https://api.example.com/health/ready';

  expect(diffManifest(changedHealthUrl, currentProject()).componentsChanged)
    .toContainEqual({
      name: 'web',
      field: 'healthUrl',
      from: null,
      to: 'https://api.example.com/health/ready',
    });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
pnpm exec vitest run packages/manifest/src/diff.test.ts --reporter=verbose
```

Expected: FAIL because `CurrentProject` and `componentFields` do not contain
`healthUrl`.

- [ ] **Step 3: Extend the diff model and comparison**

Add the optional field to `CurrentProject.components` in
`packages/manifest/src/diff.ts`:

```ts
healthUrl?: string | null;
```

Add this tuple immediately after the existing `url` tuple:

```ts
['healthUrl', existing.healthUrl, component.healthUrl],
```

- [ ] **Step 4: Run the test and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit diff support**

```powershell
git add packages/manifest/src/diff.ts packages/manifest/src/diff.test.ts
git commit -m "feat(manifest): diff component health URLs"
```

### Task 3: Persist health URLs in PostgreSQL

**Files:**
- Modify: `packages/db/src/schema/migrations.test.ts`
- Modify: `packages/db/src/schema/projects.ts`
- Create: `drizzle/0008_component_health_url.sql`
- Create: `drizzle/meta/0008_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write the failing migration test**

Replace the current migration URL and expectation in
`packages/db/src/schema/migrations.test.ts` with:

```ts
const migrationUrl = new URL(
  '../../../../drizzle/0008_component_health_url.sql',
  import.meta.url,
);

describe('component health URL migration', () => {
  it('adds only the nullable health URL column', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(normalizeLineEndings(migration)).toBe(
      'ALTER TABLE "components" ADD COLUMN "health_url" text;',
    );
  });
});
```

- [ ] **Step 2: Run the migration test and verify RED**

```powershell
pnpm exec vitest run packages/db/src/schema/migrations.test.ts --reporter=verbose
```

Expected: FAIL with `ENOENT` for `0008_component_health_url.sql`.

- [ ] **Step 3: Add the schema field and generate the migration**

Add this field after `url` in `packages/db/src/schema/projects.ts`:

```ts
healthUrl: text('health_url'),
```

Generate deterministic migration artifacts:

```powershell
pnpm --filter @deployhub/db exec drizzle-kit generate --name component_health_url
```

Expected: creates `drizzle/0008_component_health_url.sql` and
`drizzle/meta/0008_snapshot.json`, and appends `0008_component_health_url` to
`drizzle/meta/_journal.json`.

- [ ] **Step 4: Run the migration test and verify GREEN**

Run the Step 2 command.

Expected: PASS with the single nullable-column statement.

- [ ] **Step 5: Commit persistence schema and migration**

```powershell
git add packages/db/src/schema/projects.ts packages/db/src/schema/migrations.test.ts drizzle/0008_component_health_url.sql drizzle/meta/0008_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): store component health URLs"
```

### Task 4: Round-trip the field through approval, API, CLI, and review UI

**Files:**
- Modify: `apps/web/src/actions/drafts.test.ts`
- Modify: `apps/web/src/actions/drafts.ts`
- Modify: `apps/web/src/app/api/v1/projects/[slug]/routes.test.ts`
- Modify: `apps/web/src/app/api/v1/projects/[slug]/manifest/route.ts`
- Modify: `packages/cli/src/api.test.ts`
- Modify: `packages/cli/src/api.ts`
- Modify: `apps/web/src/app/drafts/pages.test.ts`
- Modify: `apps/web/src/app/settings/drafts/[id]/page.tsx`

- [ ] **Step 1: Write failing draft persistence assertions**

Add this line to the API component in the manifest fixture inside
`apps/web/src/actions/drafts.test.ts`:

```yaml
      healthUrl: https://hub.nolzza.net/api/health/ready
```

Select `healthUrl` beside `url` in component queries and extend expected rows:

```ts
healthUrl: schema.components.healthUrl,
```

```ts
healthUrl: 'https://hub.nolzza.net/api/health/ready',
```

For components without the field, assert:

```ts
healthUrl: null,
```

- [ ] **Step 2: Write failing API, CLI, and review assertions**

In `apps/web/src/app/api/v1/projects/[slug]/routes.test.ts`, seed and expect:

```ts
healthUrl: 'https://hub.nolzza.net/api/health/ready',
```

In `packages/cli/src/api.test.ts`, include the same nullable property in valid
current-project payloads and add an invalid-payload assertion where
`healthUrl: 42` causes `getCurrentProject()` to reject.

In `apps/web/src/app/drafts/pages.test.ts`, extend the deployment declarations
test:

```ts
expect(detail).toContain('component.healthUrl');
```

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
pnpm exec vitest run apps/web/src/actions/drafts.test.ts 'apps/web/src/app/api/v1/projects/[slug]/routes.test.ts' packages/cli/src/api.test.ts apps/web/src/app/drafts/pages.test.ts --reporter=verbose
```

Expected: FAIL because persistence, response validation, and the review UI omit
`healthUrl`.

- [ ] **Step 4: Implement approval persistence**

In `apps/web/src/actions/drafts.ts`, add the field to `values`:

```ts
healthUrl: component.healthUrl ?? null,
```

Add it to the upsert `set` object:

```ts
healthUrl: values.healthUrl,
```

- [ ] **Step 5: Implement API and CLI round-trip**

In the manifest route component mapping, add:

```ts
healthUrl: component.healthUrl,
```

In `packages/cli/src/api.ts`, accept the optional nullable response field:

```ts
&& (
  item.healthUrl === undefined
  || isNullableString(item.healthUrl)
)
```

- [ ] **Step 6: Show the endpoint during human review**

Add this declaration after `url` in the Draft detail page:

```ts
['healthUrl', component.healthUrl],
```

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run the Step 3 command.

Expected: all four test files pass.

- [ ] **Step 8: Commit the round-trip**

```powershell
git add apps/web/src/actions/drafts.ts apps/web/src/actions/drafts.test.ts 'apps/web/src/app/api/v1/projects/[slug]/manifest/route.ts' 'apps/web/src/app/api/v1/projects/[slug]/routes.test.ts' packages/cli/src/api.ts packages/cli/src/api.test.ts 'apps/web/src/app/settings/drafts/[id]/page.tsx' apps/web/src/app/drafts/pages.test.ts
git commit -m "feat(web): round-trip component health URLs"
```

### Task 5: Select explicit worker targets and suppress same-origin roots

**Files:**
- Modify: `apps/worker/src/handlers/health-check.test.ts`
- Modify: `apps/worker/src/handlers/health-check.ts`

- [ ] **Step 1: Write the Yield regression test**

Add a test that inserts an API component and its project domain:

```ts
it('uses an explicit component health URL instead of its same-origin root', async () => {
  const projectId = await insertProject('yield');
  const [component] = await db.insert(schema.components).values({
    projectId,
    name: 'api',
    slug: 'api',
    componentType: 'api',
    url: 'https://api.yield.ktgobiz.co.kr',
    healthUrl: 'https://api.yield.ktgobiz.co.kr/health/ready',
  }).returning({ id: schema.components.id });
  await db.insert(schema.domains).values({
    projectId,
    componentId: null,
    domain: 'api.yield.ktgobiz.co.kr',
    environment: 'production',
  });
  const checkHttp = vi.fn().mockResolvedValue({
    kind: 'up',
    status: 200,
    latencyMs: 1,
  } satisfies HealthResult);

  await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

  expect(checkHttp).toHaveBeenCalledOnce();
  expect(checkHttp).toHaveBeenCalledWith(
    'https://api.yield.ktgobiz.co.kr/health/ready',
    1_234,
  );
  expect(await db.select().from(schema.changeEvents)).toMatchObject([{
    projectId,
    componentId: component!.id,
    kind: 'health_status',
    severity: 'info',
    currentValue: 'up',
  }]);
});
```

- [ ] **Step 2: Write compatibility tests**

Add a test proving a component without `healthUrl` still checks its `url`:

```ts
it('keeps checking the component URL when no health URL is declared', async () => {
  const projectId = await insertProject('legacy-health-target');
  await insertComponent(
    projectId,
    'api',
    'https://legacy.example.com',
  );
  const checkHttp = vi.fn().mockResolvedValue({
    kind: 'up',
    status: 200,
    latencyMs: 1,
  } satisfies HealthResult);

  await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

  expect(checkHttp).toHaveBeenCalledOnce();
  expect(checkHttp).toHaveBeenCalledWith(
    'https://legacy.example.com',
    1_234,
  );
});
```

Add a test proving an explicit endpoint can use another origin, still suppresses
the component origin's domain root, and does not suppress an unrelated domain:

```ts
it('keeps a different-origin domain alongside an explicit health URL', async () => {
  const projectId = await insertProject('split-health-origin');
  await db.insert(schema.components).values({
    projectId,
    name: 'api',
    slug: 'api',
    componentType: 'api',
    url: 'https://api.example.com',
    healthUrl: 'https://status.example.net/api/ready',
  });
  await db.insert(schema.domains).values([
    {
      projectId,
      domain: 'api.example.com',
      environment: 'production',
    },
    {
      projectId,
      domain: 'www.example.com',
      environment: 'production',
    },
  ]);
  const checkHttp = vi.fn().mockResolvedValue({
    kind: 'up',
    status: 200,
    latencyMs: 1,
  } satisfies HealthResult);

  await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

  expect(checkHttp).toHaveBeenCalledTimes(2);
  expect(checkHttp).toHaveBeenCalledWith(
    'https://status.example.net/api/ready',
    1_234,
  );
  expect(checkHttp).toHaveBeenCalledWith(
    'https://www.example.com',
    1_234,
  );
  expect(checkHttp).not.toHaveBeenCalledWith(
    'https://api.example.com',
    1_234,
  );
});
```

- [ ] **Step 3: Run the worker tests and verify RED**

```powershell
pnpm exec vitest run apps/worker/src/handlers/health-check.test.ts --reporter=verbose
```

Expected: FAIL because the worker still checks the component and domain roots
and does not select `healthUrl`.

- [ ] **Step 4: Select targets by explicit URL and normalized origin**

Select `healthUrl` in the component query:

```ts
healthUrl: schema.components.healthUrl,
```

After loading components, compute explicitly covered origins:

```ts
const explicitComponentOrigins = new Set(
  components.flatMap((component) => (
    component.url !== null && component.healthUrl !== null
      ? [new URL(component.url).origin]
      : []
  )),
);
```

Skip a domain root when that origin is covered:

```ts
for (const domain of domains) {
  const url = `https://${domain.domain}`;
  if (explicitComponentOrigins.has(new URL(url).origin)) continue;
  addTarget(url, 'domain', {
    projectId: domain.projectId,
    componentId: domain.componentId,
    resourceId: null,
  });
}
```

Select the effective component URL:

```ts
for (const component of components) {
  const url = component.healthUrl ?? component.url;
  if (url !== null) {
    addTarget(url, 'component', {
      projectId: component.projectId,
      componentId: component.componentId,
      resourceId: null,
    });
  }
}
```

- [ ] **Step 5: Run the worker tests and verify GREEN**

Run the Step 3 command.

Expected: all worker health tests pass, including legacy URL and concurrency
coverage.

- [ ] **Step 6: Commit worker behavior**

```powershell
git add apps/worker/src/handlers/health-check.ts apps/worker/src/handlers/health-check.test.ts
git commit -m "fix(worker): honor component health URLs"
```

### Task 6: Document the manifest field

**Files:**
- Modify: `docs/project-registration.md`

- [ ] **Step 1: Add the operator contract**

Extend the deployment declaration list and field table with:

```markdown
- `healthUrl`에는 외부에서 인증 없이 `GET`할 수 있고 구성요소의 실제 준비
  상태를 검증하는 확인된 HTTP(S) 전체 URL만 적는다. 응답 본문이나 비밀값은
  요구하지 않아야 한다.
```

```markdown
| `healthUrl` | | `http://` 또는 `https://` 전체 URL — 구성요소의 확인된 readiness/health endpoint |
```

Document that an explicit endpoint replaces the same-origin domain root HTTP
probe but does not disable TLS monitoring.

- [ ] **Step 2: Verify documentation and commit**

```powershell
rg -n "healthUrl|same-origin|TLS" docs/project-registration.md
git diff --check
git add docs/project-registration.md
git commit -m "docs: explain component health URLs"
```

Expected: all three concepts are present and `git diff --check` is silent.

### Task 7: Verify DeployHub and stage Yield adoption safely

**Files:**
- Modify after remote schema deployment: `C:/Dev/Yield/deployhub.yaml`

- [ ] **Step 1: Run focused and repository-wide verification**

```powershell
pnpm exec vitest run packages/manifest/src/schema.test.ts packages/manifest/src/json-schema.test.ts packages/manifest/src/diff.test.ts packages/db/src/schema/migrations.test.ts apps/web/src/actions/drafts.test.ts 'apps/web/src/app/api/v1/projects/[slug]/routes.test.ts' packages/cli/src/api.test.ts apps/web/src/app/drafts/pages.test.ts apps/worker/src/handlers/health-check.test.ts
pnpm typecheck
pnpm --filter @deployhub/cli build
pnpm test
```

Expected: focused tests pass, all workspace typechecks pass, CLI build succeeds,
and the full suite reports at least the 646 baseline tests plus the new tests
with zero failures.

- [ ] **Step 2: Verify the live readiness endpoint before registration**

```powershell
curl.exe -sS --max-time 15 -o NUL -w "STATUS=%{http_code}`n" https://api.yield.ktgobiz.co.kr/health/ready
```

Expected: `STATUS=200`.

- [ ] **Step 3: Confirm registration prerequisites without printing values**

From `C:/Dev/Yield`, run:

```powershell
$urlState = if ([string]::IsNullOrWhiteSpace($env:DEPLOYHUB_URL)) { 'UNSET' } else { 'SET' }
$tokenState = if ([string]::IsNullOrWhiteSpace($env:DEPLOYHUB_TOKEN)) { 'UNSET' } else { 'SET' }
Write-Output "DEPLOYHUB_URL=$urlState"
Write-Output "DEPLOYHUB_TOKEN=$tokenState"
```

Expected: both are `SET`. If either is `UNSET`, stop before modifying the Yield
manifest and request environment configuration; never request or print the raw
token.

- [ ] **Step 4: Run the existing-project pre-change checks**

From `C:/Dev/Yield`, using the built CLI in the DeployHub worktree:

```powershell
node C:/Dev/DeployHub/.worktrees/health-url/packages/cli/dist/index.js status
node C:/Dev/DeployHub/.worktrees/health-url/packages/cli/dist/index.js diff
```

Expected: the registered project is `yield`; review the reported drift before
editing.

- [ ] **Step 5: Wait for the updated remote Schema deployment**

Fetch the schema URL already present on line 1 of `deployhub.yaml` and confirm it
contains `healthUrl`:

```powershell
$schema = Invoke-RestMethod https://hub.nolzza.net/schemas/deployhub-v1.json
$componentProperties = $schema.properties.spec.properties.components.items.properties
if ($null -eq $componentProperties.healthUrl) { throw 'Remote Schema does not expose healthUrl' }
```

Expected: no exception. If the field is absent, stop; do not submit a manifest
that the deployed server cannot validate.

- [ ] **Step 6: Add Yield's confirmed readiness URL**

Apply this exact manifest change under the `api` component, immediately after
its base `url`:

```yaml
      url: https://api.yield.ktgobiz.co.kr
      healthUrl: https://api.yield.ktgobiz.co.kr/health/ready
```

Preserve the unrelated untracked `C:/Dev/Yield/.gstack/` directory.

- [ ] **Step 7: Validate and submit a Draft**

From `C:/Dev/Yield`:

```powershell
node C:/Dev/DeployHub/.worktrees/health-url/packages/cli/dist/index.js validate
node C:/Dev/DeployHub/.worktrees/health-url/packages/cli/dist/index.js sync --draft
```

Expected: validation succeeds and the CLI prints a Draft URL. A human reviews
the exact `healthUrl` and approves the Draft in DeployHub.

- [ ] **Step 8: Verify recovery after approval**

Within five minutes of approval, inspect the Yield project and confirm the
latest API `health_status` event is:

```text
up · Health check for https://api.yield.ktgobiz.co.kr/health/ready
```

Confirm the project judgement changes from `장애` to `정상`, assuming no other
latest warning or critical event exists.

- [ ] **Step 9: Commit only the Yield manifest**

From `C:/Dev/Yield`:

```powershell
git add deployhub.yaml
git commit -m "chore: monitor the API readiness endpoint"
```

Expected: the commit contains only `deployhub.yaml`; `.gstack/` remains
untracked and untouched.

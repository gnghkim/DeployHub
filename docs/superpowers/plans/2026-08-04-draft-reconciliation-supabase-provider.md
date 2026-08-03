# Draft Reconciliation and Supabase Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved Drafts immediately reconcile existing Vercel, Docker, and Supabase observations, and add a secure PAT-based Supabase project sync path with clear UI states.

**Architecture:** Keep Draft approval database-only and deterministic: apply the manifest and rebuild automatic links in the approval transaction, then enqueue deduplicated refresh jobs after commit. Add Supabase as a normal collector/provider-account/worker pipeline, and derive project observation messages from existing provider-account timestamps plus active jobs instead of persisting duplicate state.

**Tech Stack:** TypeScript 6, Next.js 16 Server Components/Server Actions, React 19, Drizzle ORM/PostgreSQL 17, Vitest 4, Testcontainers, pnpm workspaces.

---

## File map

- `packages/collectors/src/supabase/index.ts`: authenticated Management API client and safe connection errors.
- `packages/collectors/src/supabase/normalize.ts`: allow-list Supabase project fields into `ExternalResource`.
- `packages/collectors/src/supabase/*.test.ts`: request, normalization, empty/malformed response, and secret-redaction tests.
- `packages/collectors/src/types.ts`, `packages/collectors/src/index.ts`: export the Supabase collector contract.
- `packages/db/src/queries/declared-link.ts`: exact Supabase multi-linking and stale automatic-link cleanup.
- `apps/web/src/lib/declared-link.test.ts`: pure matching regression tests.
- `apps/worker/src/handlers/supabase-sync.ts`: decrypt PAT, persist projects, soft-delete missing projects, reconcile links, and record safe sync state.
- `apps/worker/src/handlers/supabase-sync.test.ts`: database-backed handler and enqueue-deduplication tests.
- `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`: register startup and six-hour Supabase sync.
- `apps/worker/src/index.test.ts`: source-level registry/schedule regression test.
- `apps/web/src/actions/providers.ts`, `apps/web/src/actions/providers.test.ts`: save, verify, enqueue, and manually sync the single Supabase account.
- `apps/web/src/app/settings/providers/page.tsx`, `providers-page.test.ts`: PAT form, guidance, account card, and empty state.
- `apps/web/src/actions/drafts.ts`, `drafts.test.ts`: transaction-time reconciliation and post-commit best-effort provider refresh.
- `apps/web/src/app/projects/[slug]/observation-state.ts`, `observation-state.test.ts`: pure derivation of missing-observation messages.
- `apps/web/src/app/projects/[slug]/composition-model.ts`, `composition.tsx`, `composition.test.ts`, `page.tsx`, `page.test.ts`: query provider/job facts and render `연결 필요`, `동기화 대기`, `동기화 필요`, or `관측되지 않음`.

### Task 1: Add the Supabase Management API collector

**Files:**
- Create: `packages/collectors/src/supabase/normalize.ts`
- Create: `packages/collectors/src/supabase/normalize.test.ts`
- Create: `packages/collectors/src/supabase/index.ts`
- Create: `packages/collectors/src/supabase/index.test.ts`
- Modify: `packages/collectors/src/types.ts:36-42`
- Modify: `packages/collectors/src/index.ts:1-31`

- [ ] **Step 1: Write failing normalization tests**

Create `packages/collectors/src/supabase/normalize.test.ts` with explicit allow-list expectations:

```ts
import { describe, expect, it, vi } from 'vitest';
import { normalizeSupabaseProject } from './normalize';

describe('normalizeSupabaseProject', () => {
  it('normalizes only non-secret project facts', () => {
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const resource = normalizeSupabaseProject({
      id: 42,
      ref: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      organization_id: 'org_123',
      database: {
        host: 'db.abcdefghijklmnopqrst.supabase.co',
        version: '17.4.1.054',
        postgres_engine: '17',
        password: 'must-not-leak',
      },
      service_role_key: 'must-not-leak',
    });

    expect(resource).toEqual({
      provider: 'supabase',
      externalId: 'abcdefghijklmnopqrst',
      resourceType: 'supabase_project',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      metadata: {
        organizationId: 'org_123',
        databaseHost: 'db.abcdefghijklmnopqrst.supabase.co',
        databaseVersion: '17.4.1.054',
        postgresEngine: '17',
      },
      observedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(JSON.stringify(resource)).not.toContain('must-not-leak');
  });

  it('rejects missing project ref or name', () => {
    expect(() => normalizeSupabaseProject({ name: 'LinkVault' }))
      .toThrow('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
    expect(() => normalizeSupabaseProject({ ref: 'abcdefghijklmnopqrst' }))
      .toThrow('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
  });
});
```

- [ ] **Step 2: Run the normalization test and verify RED**

Run: `pnpm exec vitest run packages/collectors/src/supabase/normalize.test.ts`

Expected: FAIL because `./normalize` does not exist.

- [ ] **Step 3: Implement the allow-list normalizer**

Create `packages/collectors/src/supabase/normalize.ts`:

```ts
import type { ExternalResource } from '../types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function normalizeSupabaseProject(value: unknown): ExternalResource {
  const project = record(value);
  if (typeof project.ref !== 'string' || typeof project.name !== 'string') {
    throw new Error('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
  }
  const database = record(project.database);
  const region = optionalString(project.region);
  const status = optionalString(project.status);
  return {
    provider: 'supabase',
    externalId: project.ref,
    resourceType: 'supabase_project',
    name: project.name,
    ...(status === undefined ? {} : { status }),
    ...(region === undefined ? {} : { region }),
    metadata: {
      organizationId: optionalString(project.organization_id) ?? null,
      databaseHost: optionalString(database.host) ?? null,
      databaseVersion: optionalString(database.version) ?? null,
      postgresEngine: optionalString(database.postgres_engine) ?? null,
    },
    observedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run the normalizer tests and verify GREEN**

Run: `pnpm exec vitest run packages/collectors/src/supabase/normalize.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Write failing collector request and redaction tests**

Create `packages/collectors/src/supabase/index.test.ts`. Cover a valid list, an empty list, HTTP 401, a rejected fetch containing the PAT, malformed non-array JSON, and a malformed project entry. The core assertions are:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseCollector } from './index';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function response(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
  };
}

describe('createSupabaseCollector', () => {
  it('sends the PAT only in the Authorization header', async () => {
    fetchMock.mockResolvedValue(response([{
      ref: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
    }]));
    const resources = await createSupabaseCollector('pat-secret').listResources();
    expect(resources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects',
      { headers: { authorization: 'Bearer pat-secret' } },
    );
  });

  it('returns the stable single-account identity', async () => {
    fetchMock.mockResolvedValue(response([]));
    await expect(createSupabaseCollector('pat-secret').testConnection())
      .resolves.toEqual({ ok: true, account: 'supabase' });
  });

  it('normalizes a large project list in one request', async () => {
    const projects = Array.from({ length: 500 }, (_, index) => ({
      ref: `project-ref-${index}`,
      name: `Project ${index}`,
      status: 'ACTIVE_HEALTHY',
    }));
    fetchMock.mockResolvedValue(response(projects));
    await expect(createSupabaseCollector('pat-secret').listResources())
      .resolves.toHaveLength(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a safe HTTP connection error', async () => {
    fetchMock.mockResolvedValue(response({ message: 'pat-secret' }, 401));
    const result = await createSupabaseCollector('pat-secret').testConnection();
    expect(result).toEqual({
      ok: false,
      error: 'Supabase 연결을 확인하지 못했습니다. (HTTP 401)',
    });
    expect(JSON.stringify(result)).not.toContain('pat-secret');
  });

  it('does not expose rejected-fetch text or a raw response body', async () => {
    fetchMock.mockRejectedValue(new Error('pat-secret socket error'));
    await expect(createSupabaseCollector('pat-secret').listResources())
      .rejects.toThrow('Supabase API 요청에 실패했습니다.');
  });

  it.each([{}, { projects: [] }])('rejects a non-array project list', async (body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(createSupabaseCollector('pat-secret').listResources())
      .rejects.toThrow('Supabase API 응답 형식이 올바르지 않습니다.');
  });
});
```

- [ ] **Step 6: Run the collector test and verify RED**

Run: `pnpm exec vitest run packages/collectors/src/supabase/index.test.ts`

Expected: FAIL because `createSupabaseCollector` does not exist.

- [ ] **Step 7: Implement and export the collector**

Create `packages/collectors/src/supabase/index.ts` with a single request boundary that never includes raw bodies in errors:

```ts
import type { ExternalResource, ProviderCollector } from '../types';
import { normalizeSupabaseProject } from './normalize';

const API_URL = 'https://api.supabase.com';
const CONNECTION_ERROR = 'Supabase 연결을 확인하지 못했습니다.';
const RESPONSE_ERROR = 'Supabase API 응답 형식이 올바르지 않습니다.';

class SupabaseHttpError extends Error {
  constructor(readonly status: number) {
    super(`Supabase API 요청에 실패했습니다. (HTTP ${status})`);
  }
}

function statusSuffix(error: unknown): string {
  return error instanceof SupabaseHttpError ? ` (HTTP ${error.status})` : '';
}

export function createSupabaseCollector(token: string): ProviderCollector {
  async function listProjects(): Promise<unknown[]> {
    type FetchResponse = {
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
    };
    type FetchImplementation = (
      input: string,
      init: { headers: Record<string, string> },
    ) => Promise<FetchResponse>;
    const fetchImplementation = (
      globalThis as { fetch?: FetchImplementation }
    ).fetch;
    if (fetchImplementation === undefined) {
      throw new Error('Supabase API 요청을 실행할 수 없습니다.');
    }
    let response: FetchResponse;
    try {
      response = await fetchImplementation(`${API_URL}/v1/projects`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error('Supabase API 요청에 실패했습니다.');
    }
    if (!response.ok) throw new SupabaseHttpError(response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(RESPONSE_ERROR);
    }
    if (!Array.isArray(body)) throw new Error(RESPONSE_ERROR);
    return body;
  }

  return {
    provider: 'supabase',
    async testConnection() {
      try {
        await listProjects();
        return { ok: true, account: 'supabase' };
      } catch (error) {
        return { ok: false, error: `${CONNECTION_ERROR}${statusSuffix(error)}` };
      }
    },
    async listResources(): Promise<ExternalResource[]> {
      return (await listProjects()).map(normalizeSupabaseProject);
    },
  };
}

export { normalizeSupabaseProject } from './normalize';
```

Add `export type SupabaseCollector = ProviderCollector;` to `packages/collectors/src/types.ts`, and export `createSupabaseCollector`, `normalizeSupabaseProject`, and `SupabaseCollector` from `packages/collectors/src/index.ts`.

- [ ] **Step 8: Run collector tests and typecheck**

Run: `pnpm exec vitest run packages/collectors/src/supabase/normalize.test.ts packages/collectors/src/supabase/index.test.ts && pnpm --filter @deployhub/collectors typecheck`

Expected: all Supabase collector tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit the collector**

```bash
git add packages/collectors/src/supabase packages/collectors/src/types.ts packages/collectors/src/index.ts
git commit -m "feat: add Supabase project collector"
```

### Task 2: Extend deterministic declared-resource reconciliation

**Files:**
- Modify: `packages/db/src/queries/declared-link.ts:35-214`
- Modify: `apps/web/src/lib/declared-link.test.ts:1-101`

- [ ] **Step 1: Write failing exact-ref multi-link and stale-link tests**

Extend `apps/web/src/lib/declared-link.test.ts` with two Supabase components sharing one project ref and change expected single-link decisions to `kind: 'links'`:

```ts
const database: DeclaredComponent = {
  ...web,
  id: 'component-database',
  name: 'database',
  slug: 'database',
  provider: 'supabase',
  externalRef: 'abcdefghijklmnopqrst',
  containerName: null,
};
const authentication: DeclaredComponent = {
  ...database,
  id: 'component-authentication',
  name: 'authentication',
  slug: 'authentication',
};

it('links one Supabase project to every exact-ref component', () => {
  expect(resolveDeclaredLink({
    id: 'resource-supabase',
    provider: 'supabase',
    resourceType: 'supabase_project',
    externalId: 'abcdefghijklmnopqrst',
    name: 'LinkVault',
    metadata: {},
  }, [database, authentication], [])).toEqual({
    kind: 'links',
    links: [
      { componentId: database.id, linkedBy: 'manifest', environment: 'production' },
      { componentId: authentication.id, linkedBy: 'manifest', environment: 'production' },
    ],
  });
});

it('does not partially match a Supabase project ref', () => {
  expect(resolveDeclaredLink({
    id: 'resource-supabase',
    provider: 'supabase',
    resourceType: 'supabase_project',
    externalId: 'abcdefghijklmnopqrst-old',
    name: 'LinkVault',
    metadata: {},
  }, [database], [])).toEqual({ kind: 'none', reason: 'no_match' });
});
```

Also add a database-backed case to `apps/web/src/actions/drafts.test.ts` in Task 7 that starts with a stale `linkedBy: 'manifest'` row and verifies it is removed after approval.

- [ ] **Step 2: Run pure declared-link tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/lib/declared-link.test.ts`

Expected: FAIL because Supabase returns `no_match` and existing decisions use `kind: 'link'`.

- [ ] **Step 3: Change the decision to an explicit link list**

In `packages/db/src/queries/declared-link.ts`, make `provider` accept Supabase and replace the single-link variant:

```ts
export type DeclaredLink = {
  componentId: string;
  linkedBy: 'manifest' | 'label';
  environment: string;
};

export type DeclaredLinkDecision =
  | { kind: 'links'; links: DeclaredLink[] }
  | {
    kind: 'conflict';
    containerName: string;
    manifestComponentId: string;
    manifestComponentName: string;
    labelComponentId: string;
    labelComponentName: string;
  }
  | { kind: 'none'; reason: 'no_match' | 'user_link' };

export type LinkDeclaredResourcesInput = {
  provider: 'docker' | 'vercel' | 'supabase';
  externalIds?: string[];
};
```

Add this branch immediately after the user-link guard:

```ts
if (
  resource.provider === 'supabase'
  && resource.resourceType === 'supabase_project'
) {
  const matches = components.filter((component) => (
    component.provider === 'supabase'
    && component.externalRef === resource.externalId
  ));
  return matches.length === 0
    ? { kind: 'none', reason: 'no_match' }
    : {
        kind: 'links',
        links: matches.map((component) => ({
          componentId: component.id,
          linkedBy: 'manifest',
          environment: 'production',
        })),
      };
}
```

Return `kind: 'links', links: [link]` from the existing Vercel and Docker success branches.

- [ ] **Step 4: Make resource selection optional and rebuild automatic links**

Build the resource predicate from provider, active state, and optional IDs:

```ts
const conditions = [
  eq(resources.provider, input.provider),
  isNull(resources.deletedAt),
];
if (input.externalIds !== undefined) {
  if (input.externalIds.length === 0) return;
  conditions.push(inArray(resources.externalId, input.externalIds));
}
const observed = await db.select({
  id: resources.id,
  provider: resources.provider,
  resourceType: resources.resourceType,
  externalId: resources.externalId,
  name: resources.name,
  metadata: resources.metadata,
}).from(resources).where(and(...conditions));
```

For each resource, preserve user links, otherwise delete old `manifest`/`label` links before handling no-match/conflict and insert every resolved link:

```ts
const decision = resolveDeclaredLink(resource, declarations, existingLinks);
if (decision.kind === 'none' && decision.reason === 'user_link') continue;
await db.delete(componentResources).where(and(
  eq(componentResources.resourceId, resource.id),
  inArray(componentResources.linkedBy, ['manifest', 'label']),
));
if (decision.kind !== 'links') continue;
for (const link of decision.links) {
  await db.insert(componentResources).values({
    componentId: link.componentId,
    resourceId: resource.id,
    environment: link.environment,
    relationType: 'deployed_to',
    isPrimary: true,
    linkedBy: link.linkedBy,
  }).onConflictDoNothing({
    target: [
      componentResources.componentId,
      componentResources.resourceId,
      componentResources.environment,
    ],
  });
}
```

- [ ] **Step 5: Run declared-link and existing provider handler tests**

Run: `pnpm exec vitest run apps/web/src/lib/declared-link.test.ts apps/worker/src/handlers/vercel-sync.test.ts apps/worker/src/handlers/docker-sync.test.ts --maxWorkers=1`

Expected: all tests PASS; no Vercel or Docker regression.

- [ ] **Step 6: Commit reconciliation support**

```bash
git add packages/db/src/queries/declared-link.ts apps/web/src/lib/declared-link.test.ts
git commit -m "feat: reconcile exact declared resource links"
```

### Task 3: Add the Supabase sync worker handler

**Files:**
- Create: `apps/worker/src/handlers/supabase-sync.ts`
- Create: `apps/worker/src/handlers/supabase-sync.test.ts`
- Modify: `apps/worker/src/handlers/index.ts:1-30`

- [ ] **Step 1: Write failing database-backed handler tests**

Model setup/teardown on `vercel-sync.test.ts`, using `startTestDb()` and a fake `SupabaseCollector`. Cover exact persistence, soft deletion, multi-linking, safe failures, and active-job deduplication:

```ts
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db, type JobRecord } from '@deployhub/db';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import { encrypt } from '@deployhub/shared';

let db: Db;
let stop: () => Promise<void>;
const encryptionKey = Buffer.alloc(32, 7);

beforeAll(async () => {
  ({ db, stop } = await startTestDb());
}, 120_000);
afterAll(async () => { await stop(); });
beforeEach(async () => {
  await db.delete(schema.componentResources);
  await db.delete(schema.resources);
  await db.delete(schema.components);
  await db.delete(schema.projects);
  await db.delete(schema.jobs);
  await db.delete(schema.providerAccounts);
});

function job(accountId: string): JobRecord {
  return {
    id: 'job-supabase',
    type: 'supabase.sync',
    payload: { accountId },
    attempts: 0,
    maxAttempts: 3,
  };
}

async function insertSupabaseAccount(token = 'supabase-test-token'): Promise<string> {
  const [row] = await db.insert(schema.providerAccounts).values({
    provider: 'supabase',
    name: 'supabase',
    encryptedToken: encrypt(token, encryptionKey),
  }).returning({ id: schema.providerAccounts.id });
  if (!row) throw new Error('test account insert failed');
  return row.id;
}

async function insertProjectWithSupabaseComponents(
  definitions: Array<[name: string, externalRef: string]>,
): Promise<string> {
  const [project] = await db.insert(schema.projects).values({
    name: 'LinkVault',
    slug: 'linkvault',
    lifecycle: 'production',
  }).returning({ id: schema.projects.id });
  if (!project) throw new Error('test project insert failed');
  await db.insert(schema.components).values(definitions.map(([name, externalRef]) => ({
    projectId: project.id,
    name,
    slug: name,
    componentType: name === 'database' ? 'database' : 'authentication',
    provider: 'supabase',
    externalRef,
  })));
  return project.id;
}

async function account(id: string) {
  const [row] = await db.select().from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.id, id));
  return row;
}

it('upserts visible projects, links exact refs, and records success', async () => {
  const accountId = await insertSupabaseAccount();
  const projectId = await insertProjectWithSupabaseComponents([
    ['database', 'abcdefghijklmnopqrst'],
    ['authentication', 'abcdefghijklmnopqrst'],
  ]);
  const handler = createSupabaseSyncHandler(db, encryptionKey, {
    createCollector: () => ({
      provider: 'supabase',
      testConnection: async () => ({ ok: true, account: 'supabase' }),
      listResources: async () => [{
        provider: 'supabase',
        externalId: 'abcdefghijklmnopqrst',
        resourceType: 'supabase_project',
        name: 'LinkVault',
        status: 'ACTIVE_HEALTHY',
        region: 'ap-northeast-2',
        metadata: { organizationId: 'org_123' },
        observedAt: new Date().toISOString(),
      }],
    }),
  });

  await handler(job(accountId));

  expect(await db.select().from(schema.resources)).toEqual([
    expect.objectContaining({
      provider: 'supabase',
      providerAccountId: accountId,
      externalId: 'abcdefghijklmnopqrst',
      resourceType: 'supabase_project',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      deletedAt: null,
    }),
  ]);
  const links = await db.select().from(schema.componentResources);
  expect(links).toHaveLength(2);
  expect(new Set(links.map(({ componentId }) => componentId)).size).toBe(2);
  expect((await account(accountId))?.lastSyncAt).toBeInstanceOf(Date);
  expect((await account(accountId))?.lastError).toBeNull();
  expect(projectId).toBeTruthy();
});

it('keeps previous observations and stores only a safe error', async () => {
  const token = 'supabase-secret-that-must-not-leak';
  const accountId = await insertSupabaseAccount(token);
  const handler = createSupabaseSyncHandler(db, encryptionKey, {
    createCollector: () => ({
      provider: 'supabase',
      testConnection: async () => ({ ok: true, account: 'supabase' }),
      listResources: async () => {
        throw new Error(`HTTP 401 ${token}`);
      },
    }),
  });
  await expect(handler(job(accountId))).rejects.toThrow(
    'Supabase 동기화에 실패했습니다. (HTTP 401)',
  );
  expect((await account(accountId))?.lastError).toBe(
    'Supabase 동기화에 실패했습니다. (HTTP 401)',
  );
  expect(JSON.stringify(await account(accountId))).not.toContain(token);
});
```

Add tests that seed two resources, return one, and assert the missing row receives `deletedAt`; call `enqueueSupabaseSyncJobs(db)` twice and assert only one pending `supabase.sync` job exists for the account.

Use these exact assertions for the remaining cases:

```ts
await handler(job(accountId));
expect((await db.select().from(schema.resources)).find(
  ({ externalId }) => externalId === 'missing-project',
)?.deletedAt).toBeInstanceOf(Date);

await enqueueSupabaseSyncJobs(db);
await enqueueSupabaseSyncJobs(db);
const queued = await db.select().from(schema.jobs);
expect(queued.filter(({ type }) => type === 'supabase.sync')).toHaveLength(1);
expect(queued[0]).toMatchObject({
  dedupeKey: `supabase:${accountId}`,
  status: 'pending',
  payload: { accountId },
});
```

- [ ] **Step 2: Run the handler test and verify RED**

Run: `pnpm exec vitest run apps/worker/src/handlers/supabase-sync.test.ts --maxWorkers=1`

Expected: FAIL because the handler module does not exist.

- [ ] **Step 3: Implement the Supabase sync handler**

Create `apps/worker/src/handlers/supabase-sync.ts` following the existing Vercel transaction pattern without deployments:

```ts
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { createSupabaseCollector, type SupabaseCollector } from '@deployhub/collectors';
import { enqueueUnique, linkDeclaredResources, schema, type Db } from '@deployhub/db';
import { decrypt } from '@deployhub/shared';
import type { JobHandler } from '../runner';

const SYNC_ERROR = 'Supabase 동기화에 실패했습니다.';

type Dependencies = {
  createCollector?: (token: string) => SupabaseCollector;
};

function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = /\bHTTP\s+(\d{3})\b/.exec(message)?.[1];
  return status === undefined ? SYNC_ERROR : `${SYNC_ERROR} (HTTP ${status})`;
}

export function createSupabaseSyncHandler(
  db: Db,
  encryptionKey: Buffer,
  dependencies: Dependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector ?? createSupabaseCollector;
  return async (job) => {
    const accountId = typeof job.payload.accountId === 'string'
      ? job.payload.accountId
      : undefined;
    if (accountId === undefined) throw new Error('Supabase 동기화 accountId가 없습니다.');
    const [account] = await db.select().from(schema.providerAccounts).where(and(
      eq(schema.providerAccounts.id, accountId),
      eq(schema.providerAccounts.provider, 'supabase'),
    ));
    if (!account) throw new Error('Supabase 계정을 찾을 수 없습니다.');

    try {
      const resources = await createCollector(
        decrypt(account.encryptedToken, encryptionKey),
      ).listResources();
      const externalIds = resources.map(({ externalId }) => externalId);
      await db.transaction(async (tx) => {
        for (const resource of resources) {
          await tx.insert(schema.resources).values({
            provider: 'supabase',
            providerAccountId: account.id,
            externalId: resource.externalId,
            resourceType: 'supabase_project',
            name: resource.name,
            status: resource.status ?? null,
            region: resource.region ?? null,
            url: resource.url ?? null,
            metadata: resource.metadata,
            lastSeenAt: sql`now()`,
            deletedAt: null,
          }).onConflictDoUpdate({
            target: [schema.resources.provider, schema.resources.externalId],
            set: {
              providerAccountId: account.id,
              resourceType: 'supabase_project',
              name: resource.name,
              status: resource.status ?? null,
              region: resource.region ?? null,
              url: resource.url ?? null,
              metadata: resource.metadata,
              lastSeenAt: sql`now()`,
              deletedAt: null,
            },
          });
        }
        const missing = [
          eq(schema.resources.provider, 'supabase'),
          eq(schema.resources.providerAccountId, account.id),
          isNull(schema.resources.deletedAt),
        ];
        if (externalIds.length > 0) {
          missing.push(notInArray(schema.resources.externalId, externalIds));
        }
        await tx.update(schema.resources).set({ deletedAt: sql`now()` })
          .where(and(...missing));
        await linkDeclaredResources(tx, { provider: 'supabase', externalIds });
        await tx.update(schema.providerAccounts).set({
          lastSyncAt: sql`now()`,
          lastError: null,
        }).where(eq(schema.providerAccounts.id, account.id));
      });
    } catch (error) {
      const message = safeSyncError(error);
      await db.update(schema.providerAccounts).set({ lastError: message })
        .where(eq(schema.providerAccounts.id, account.id));
      throw new Error(message);
    }
  };
}

export async function enqueueSupabaseSyncJobs(db: Db): Promise<void> {
  const accounts = await db.select({ id: schema.providerAccounts.id })
    .from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.provider, 'supabase'));
  for (const { id } of accounts) {
    await enqueueUnique(db, {
      type: 'supabase.sync',
      dedupeKey: `supabase:${id}`,
      payload: { accountId: id },
    });
  }
}
```

Export both functions from `apps/worker/src/handlers/index.ts`.

- [ ] **Step 4: Run handler tests and worker typecheck**

Run: `pnpm exec vitest run apps/worker/src/handlers/supabase-sync.test.ts --maxWorkers=1 && pnpm --filter worker typecheck`

Expected: all Supabase worker tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the handler**

```bash
git add apps/worker/src/handlers/supabase-sync.ts apps/worker/src/handlers/supabase-sync.test.ts apps/worker/src/handlers/index.ts
git commit -m "feat: sync Supabase project resources"
```

### Task 4: Register startup and six-hour Supabase schedules

**Files:**
- Create: `apps/worker/src/index.test.ts`
- Modify: `apps/worker/src/index.ts:7-101`

- [ ] **Step 1: Write a failing source-level schedule test**

Create `apps/worker/src/index.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('worker provider schedules', () => {
  it('registers, schedules, starts, and clears Supabase sync', () => {
    expect(source).toContain("'supabase.sync': createSupabaseSyncHandler(db, encryptionKey)");
    expect(source).toMatch(/const supabaseSchedule = setInterval\([\s\S]*?enqueueSupabaseSyncJobs\(db\)[\s\S]*?PROVIDER_SYNC_INTERVAL_MS/);
    expect(source).toContain('await enqueueSupabaseSyncJobs(db)');
    expect(source).toContain('clearInterval(supabaseSchedule)');
  });
});
```

- [ ] **Step 2: Run the schedule test and verify RED**

Run: `pnpm exec vitest run apps/worker/src/index.test.ts`

Expected: FAIL because the Supabase registry and schedule are absent.

- [ ] **Step 3: Wire the handler into worker startup and shutdown**

Import `createSupabaseSyncHandler` and `enqueueSupabaseSyncJobs`; add `'supabase.sync'` to the handler registry. Add a six-hour interval with a secret-free log message:

```ts
const supabaseSchedule = setInterval(() => {
  void enqueueSupabaseSyncJobs(db).catch(() => {
    console.error('[worker] Supabase 동기화 job 등록 실패');
  });
}, PROVIDER_SYNC_INTERVAL_MS);
```

Call `clearInterval(supabaseSchedule)` in `shutdown`, and call `await enqueueSupabaseSyncJobs(db)` beside the GitHub/Vercel startup enqueues.

- [ ] **Step 4: Run the schedule test, worker typecheck, and worker build**

Run: `pnpm exec vitest run apps/worker/src/index.test.ts && pnpm --filter worker typecheck && pnpm --filter worker build`

Expected: test PASS; typecheck and build exit 0.

- [ ] **Step 5: Commit worker registration**

```bash
git add apps/worker/src/index.ts apps/worker/src/index.test.ts
git commit -m "feat: schedule Supabase provider sync"
```

### Task 5: Add secure Supabase provider server actions

**Files:**
- Modify: `apps/web/src/actions/providers.ts:3-186`
- Modify: `apps/web/src/actions/providers.test.ts:1-255`

- [ ] **Step 1: Extend action mocks and write failing Supabase tests**

Add `createSupabaseCollector`, `enqueueUnique`, and `returning` mocks using the existing hoisted-mock style:

```ts
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createGithubCollector: vi.fn(),
  createVercelCollector: vi.fn(),
  createSupabaseCollector: vi.fn(),
  encrypt: vi.fn(),
  loadEncryptionKey: vi.fn(),
  enqueue: vi.fn(),
  enqueueUnique: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  returning: vi.fn(),
}));

mocks.insert.mockReturnValue({ values: mocks.values });
mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
mocks.onConflictDoUpdate.mockReturnValue({ returning: mocks.returning });
```

Expose the new mocks from the existing partial `@deployhub/collectors` and `@deployhub/db` mocks. Then add tests for authentication, blank PAT, safe failed connection, encryption/upsert by the stable name, immediate deduplicated enqueue, and manual enqueue:

```ts
it('verifies, encrypts, stores, and immediately queues the single Supabase account', async () => {
  const token = 'supabase-save-secret';
  mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
  mocks.createSupabaseCollector.mockReturnValue({
    testConnection: vi.fn().mockResolvedValue({ ok: true, account: 'supabase' }),
  });
  mocks.returning.mockResolvedValue([{ id: 'supabase-account-id' }]);
  const formData = new FormData();
  formData.set('token', ` ${token} `);

  const result = await saveSupabaseProvider(emptyState, formData);

  expect(result.status).toBe('success');
  expect(mocks.encrypt).toHaveBeenCalledWith(token, Buffer.alloc(32));
  expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'supabase',
    name: 'supabase',
    encryptedToken: 'encrypted-payload',
  }));
  expect(mocks.enqueueUnique).toHaveBeenCalledWith(expect.anything(), {
    type: 'supabase.sync',
    dedupeKey: 'supabase:supabase-account-id',
    payload: { accountId: 'supabase-account-id' },
  });
  expect(JSON.stringify(result)).not.toContain(token);
});

it('queues a manual Supabase sync only for an authenticated administrator', async () => {
  mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
  const formData = new FormData();
  formData.set('accountId', 'supabase-account-id');
  await enqueueSupabaseSync(formData);
  expect(mocks.enqueueUnique).toHaveBeenCalledWith(expect.anything(), {
    type: 'supabase.sync',
    dedupeKey: 'supabase:supabase-account-id',
    payload: { accountId: 'supabase-account-id' },
  });
});
```

- [ ] **Step 2: Run action tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/actions/providers.test.ts`

Expected: FAIL because Supabase actions are not exported.

- [ ] **Step 3: Implement save and manual-sync actions**

Add these exports to `apps/web/src/actions/providers.ts`, reusing `ProviderActionState`, `encrypt`, and `loadEncryptionKey`:

```ts
export async function saveSupabaseProvider(
  _previousState: ProviderActionState,
  formData: FormData,
): Promise<ProviderActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');
  const value = formData.get('token');
  const token = typeof value === 'string' ? value.trim() : '';
  if (token === '') {
    return { status: 'error', message: 'Supabase PAT를 입력해 주세요.' };
  }
  let connection;
  try {
    connection = await createSupabaseCollector(token).testConnection();
  } catch {
    return { status: 'error', message: 'Supabase 연결을 확인하지 못했습니다.' };
  }
  if (!connection.ok) {
    return { status: 'error', message: 'Supabase 연결을 확인하지 못했습니다.' };
  }
  try {
    const encryptedToken = encrypt(
      token,
      loadEncryptionKey(process.env.ENCRYPTION_KEY),
    );
    const [account] = await db.insert(schema.providerAccounts).values({
      provider: 'supabase',
      name: 'supabase',
      encryptedToken,
      lastVerifiedAt: sql`now()`,
      lastError: null,
    }).onConflictDoUpdate({
      target: [schema.providerAccounts.provider, schema.providerAccounts.name],
      set: { encryptedToken, lastVerifiedAt: sql`now()`, lastError: null },
    }).returning({ id: schema.providerAccounts.id });
    if (!account) throw new Error('Supabase 계정을 저장하지 못했습니다.');
    await enqueueUnique(db, {
      type: 'supabase.sync',
      dedupeKey: `supabase:${account.id}`,
      payload: { accountId: account.id },
    });
  } catch {
    return { status: 'error', message: 'Supabase 연결 정보를 저장하지 못했습니다.' };
  }
  revalidatePath('/settings/providers');
  return { status: 'success', message: 'Supabase 연결을 확인하고 안전하게 저장했습니다.' };
}

export async function enqueueSupabaseSync(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');
  const value = formData.get('accountId');
  const accountId = typeof value === 'string' ? value : '';
  if (accountId === '') throw new Error('Supabase 계정 ID가 필요합니다.');
  await enqueueUnique(db, {
    type: 'supabase.sync',
    dedupeKey: `supabase:${accountId}`,
    payload: { accountId },
  });
  revalidatePath('/settings/providers');
}
```

- [ ] **Step 4: Run action tests and web typecheck**

Run: `pnpm exec vitest run apps/web/src/actions/providers.test.ts && pnpm --filter web typecheck`

Expected: all provider action tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit provider actions**

```bash
git add apps/web/src/actions/providers.ts apps/web/src/actions/providers.test.ts
git commit -m "feat: connect Supabase provider accounts"
```

### Task 6: Add the Supabase Providers settings section

**Files:**
- Modify: `apps/web/src/app/settings/providers/page.tsx:1-185`
- Modify: `apps/web/src/app/settings/providers/providers-page.test.ts:1-117`

- [ ] **Step 1: Write failing page-source tests**

Extend `providers-page.test.ts`:

```ts
it('routes a password PAT form and account cards to Supabase actions', () => {
  expect(page).toContain("account.provider === 'supabase'");
  expect(page).toContain('Supabase 연결');
  expect(page).toContain('PAT는 연결된 Supabase 사용자의 권한으로 동작합니다.');
  expect(page).toMatch(/async function connectSupabase[\s\S]*?saveSupabaseProvider/);
  expect(page).toMatch(/name="token"[\s\S]*?type="password"/);
  expect(page).toMatch(/supabaseAccounts\.map[\s\S]*?<ProviderAccountCard[\s\S]*?syncAction=\{enqueueSupabaseSync\}/);
  expect(page).toContain('연결된 Supabase 계정이 없습니다.');
});

it('uses the shared safe account card for all three providers', () => {
  expect(page.match(/<ProviderAccountCard/g)).toHaveLength(3);
  expect(page).not.toMatch(/<ProviderAccountCard[\s\S]*?encryptedToken=/);
});
```

- [ ] **Step 2: Run page tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/app/settings/providers/providers-page.test.ts`

Expected: FAIL because the Supabase section is absent.

- [ ] **Step 3: Add the server-rendered Supabase section**

Import `saveSupabaseProvider` and `enqueueSupabaseSync`, add `connectSupabase`, and filter `supabaseAccounts`. Append this section after Vercel:

```tsx
<section className="space-y-6">
  <div>
    <h2 className="text-xl font-medium text-[var(--line)]">Supabase 연결</h2>
    <p className="mt-1 text-sm text-[var(--annotation)]">
      PAT는 연결된 Supabase 사용자의 권한으로 동작합니다. 프로젝트 조회에 필요한
      최소 권한 계정을 사용하고 PAT를 비밀값으로 관리하세요.
    </p>
  </div>
  <Card>
    <form action={connectSupabase} className="flex items-end gap-3">
      <label className="min-w-0 flex-1 text-sm text-[var(--line-mute)]">
        Personal access token
        <Input className="mt-2" name="token" type="password" autoComplete="off" required />
      </label>
      <Button variant="primary" type="submit">연결 테스트 및 저장</Button>
    </form>
  </Card>
  <div className="space-y-3">
    {supabaseAccounts.map((account) => (
      <ProviderAccountCard
        key={account.id}
        id={account.id}
        name={account.name}
        tokenSuffix={displayTokenSuffix(account.encryptedToken)}
        lastVerifiedAt={account.lastVerifiedAt}
        lastSyncAt={account.lastSyncAt}
        lastError={account.lastError}
        syncAction={enqueueSupabaseSync}
      />
    ))}
    {supabaseAccounts.length === 0 ? (
      <Card><p className="text-sm text-[var(--annotation)]">연결된 Supabase 계정이 없습니다.</p></Card>
    ) : null}
  </div>
</section>
```

- [ ] **Step 4: Run page tests and web typecheck**

Run: `pnpm exec vitest run apps/web/src/app/settings/providers/providers-page.test.ts apps/web/src/app/settings/providers/provider-account-card-render.test.ts && pnpm --filter web typecheck`

Expected: all provider page tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the provider page**

```bash
git add apps/web/src/app/settings/providers/page.tsx apps/web/src/app/settings/providers/providers-page.test.ts
git commit -m "feat: show Supabase provider settings"
```

### Task 7: Reconcile and queue refreshes during Draft approval

**Files:**
- Modify: `apps/web/src/actions/drafts.ts:1-149`
- Modify: `apps/web/src/actions/drafts.test.ts:1-310`

- [ ] **Step 1: Write failing approval integration tests**

Add a manifest fixture containing Vercel, Docker/Hostinger, and two Supabase components. Before approval, seed matching active resources and one stale automatic link. After `approveDraft`, assert:

```ts
const links = await db.select({
  componentName: schema.components.name,
  provider: schema.resources.provider,
  linkedBy: schema.componentResources.linkedBy,
}).from(schema.componentResources)
  .innerJoin(schema.components, eq(schema.components.id, schema.componentResources.componentId))
  .innerJoin(schema.resources, eq(schema.resources.id, schema.componentResources.resourceId));

expect(links).toEqual(expect.arrayContaining([
  expect.objectContaining({ componentName: 'web', provider: 'vercel', linkedBy: 'manifest' }),
  expect.objectContaining({ componentName: 'worker', provider: 'docker', linkedBy: 'manifest' }),
  expect.objectContaining({ componentName: 'database', provider: 'supabase', linkedBy: 'manifest' }),
  expect.objectContaining({ componentName: 'authentication', provider: 'supabase', linkedBy: 'manifest' }),
]));
expect(links).not.toContainEqual(expect.objectContaining({ componentName: 'legacy-api' }));
```

Seed connected Vercel/Supabase accounts and assert active jobs contain one deduplicated `vercel.sync`, one `supabase.sync`, and one `docker.sync`. Add a pure helper test that injects an enqueue function which always rejects and assert the helper resolves while calling a secret-free logger.

The failure-path assertion is:

```ts
const enqueueRefresh = vi.fn().mockRejectedValue(new Error('provider-secret'));
const logError = vi.fn();
await expect(enqueueApprovedDraftRefreshes({
  accounts: [{ id: 'account-1', provider: 'supabase' }],
  docker: true,
}, enqueueRefresh, logError)).resolves.toBeUndefined();
expect(enqueueRefresh).toHaveBeenCalledTimes(2);
expect(logError).toHaveBeenCalledWith('[draft] supabase.sync refresh job 등록 실패');
expect(logError).toHaveBeenCalledWith('[draft] docker.sync refresh job 등록 실패');
expect(JSON.stringify(logError.mock.calls)).not.toContain('provider-secret');
```

Seed a `linkedBy: 'user'` row before approval and verify its row ID and component ID remain unchanged after approval. Seed stale `manifest` and `label` rows for the old declaration and verify both are deleted.

- [ ] **Step 2: Run Draft tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/actions/drafts.test.ts --maxWorkers=1`

Expected: FAIL because approval neither reconciles nor queues refresh jobs.

- [ ] **Step 3: Return a refresh plan from the approval transaction**

Import `inArray`, `enqueueUnique`, and `linkDeclaredResources`. Define:

```ts
type ApprovedDraftRefreshPlan = {
  accounts: Array<{ id: string; provider: 'vercel' | 'supabase' }>;
  docker: boolean;
};

type ApprovedDraftResult = ApprovedDraftRefreshPlan & {
  projectSlug: string;
};

type EnqueueRefresh = typeof enqueueUnique;

export async function enqueueApprovedDraftRefreshes(
  plan: ApprovedDraftRefreshPlan,
  enqueueRefresh: EnqueueRefresh = (database, options) => enqueueUnique(database, options),
  logError: (message: string) => void = (message) => console.error(message),
): Promise<void> {
  const requests: Array<{
    type: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }> = plan.accounts.map((account) => ({
    type: `${account.provider}.sync`,
    dedupeKey: `${account.provider}:${account.id}`,
    payload: { accountId: account.id },
  }));
  if (plan.docker) {
    requests.push({ type: 'docker.sync', dedupeKey: 'docker:global', payload: {} });
  }
  for (const request of requests) {
    try {
      await enqueueRefresh(db, request);
    } catch {
      logError(`[draft] ${request.type} refresh job 등록 실패`);
    }
  }
}
```

Inside the existing transaction, after component/domain writes, run all three deterministic reconciliations:

```ts
for (const provider of ['vercel', 'docker', 'supabase'] as const) {
  await linkDeclaredResources(tx, { provider });
}
const declaredProviders = new Set(
  manifest.spec.components.flatMap((component) =>
    component.provider === 'vercel' || component.provider === 'supabase'
      ? [component.provider]
      : []
  ),
);
const accounts = declaredProviders.size === 0 ? [] : await tx.select({
  id: schema.providerAccounts.id,
  provider: schema.providerAccounts.provider,
}).from(schema.providerAccounts).where(inArray(
  schema.providerAccounts.provider,
  [...declaredProviders],
));
return {
  accounts: accounts.filter((account): account is {
    id: string;
    provider: 'vercel' | 'supabase';
  } => account.provider === 'vercel' || account.provider === 'supabase'),
  docker: manifest.spec.components.some((component) => component.container !== undefined),
  projectSlug: manifest.metadata.slug,
} satisfies ApprovedDraftResult;
```

Capture the transaction result as `const approved = await db.transaction(...)`, then call `await enqueueApprovedDraftRefreshes(approved)` after commit. Revalidate ``/projects/${approved.projectSlug}`` and `/settings/providers` in addition to the existing paths.

- [ ] **Step 4: Run Draft, declared-link, and queue tests**

Run: `pnpm exec vitest run apps/web/src/actions/drafts.test.ts apps/web/src/lib/declared-link.test.ts packages/db/src/jobs/queue.test.ts --maxWorkers=1`

Expected: all tests PASS, including approval staying approved when enqueue injection fails.

- [ ] **Step 5: Run web and database typechecks**

Run: `pnpm --filter @deployhub/db typecheck && pnpm --filter web typecheck`

Expected: both TypeScript commands exit 0.

- [ ] **Step 6: Commit approval reconciliation**

```bash
git add apps/web/src/actions/drafts.ts apps/web/src/actions/drafts.test.ts
git commit -m "feat: reconcile resources when drafts are approved"
```

### Task 8: Derive and render project observation states

**Files:**
- Create: `apps/web/src/app/projects/[slug]/observation-state.ts`
- Create: `apps/web/src/app/projects/[slug]/observation-state.test.ts`
- Modify: `apps/web/src/app/projects/[slug]/composition-model.ts:1-149`
- Modify: `apps/web/src/app/projects/[slug]/composition.tsx:67-94`
- Modify: `apps/web/src/app/projects/[slug]/composition.test.ts:1-174`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx:1-249`
- Modify: `apps/web/src/app/projects/[slug]/page.test.ts`

- [ ] **Step 1: Write failing pure state-derivation tests**

Create `observation-state.test.ts` covering all transitions:

```ts
import { describe, expect, it } from 'vitest';
import { describeMissingObservation } from './observation-state';

const component = {
  provider: 'supabase',
  externalRef: 'abcdefghijklmnopqrst',
  containerName: null,
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

describe('describeMissingObservation', () => {
  it('requires a connection when no provider account exists', () => {
    expect(describeMissingObservation(component, {
      accounts: [], activeJobs: [], dockerLastSyncAt: null,
    })).toEqual({ label: '연결 필요', detail: null });
  });

  it('shows pending while a matching account job is active', () => {
    expect(describeMissingObservation(component, {
      accounts: [{
        id: 'account-1', provider: 'supabase',
        lastSyncAt: null, lastError: null,
      }],
      activeJobs: [{ type: 'supabase.sync', payload: { accountId: 'account-1' } }],
      dockerLastSyncAt: null,
    })).toEqual({ label: '동기화 대기', detail: null });
  });

  it('shows unobserved only after a sync newer than the declaration', () => {
    expect(describeMissingObservation(component, {
      accounts: [{
        id: 'account-1', provider: 'supabase',
        lastSyncAt: new Date('2026-08-04T00:01:00.000Z'), lastError: null,
      }],
      activeJobs: [], dockerLastSyncAt: null,
    })).toEqual({ label: '관측되지 않음', detail: null });
  });

  it('shows a safe provider error with sync required', () => {
    expect(describeMissingObservation(component, {
      accounts: [{
        id: 'account-1', provider: 'supabase',
        lastSyncAt: null, lastError: 'Supabase 동기화에 실패했습니다. (HTTP 401)',
      }],
      activeJobs: [], dockerLastSyncAt: null,
    })).toEqual({
      label: '동기화 필요',
      detail: 'Supabase 동기화에 실패했습니다. (HTTP 401)',
    });
  });
});
```

Add Docker cases using `containerName` and `dockerLastSyncAt`, and a Vercel case using a matching active account job.

- [ ] **Step 2: Run state tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/app/projects/[slug]/observation-state.test.ts`

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement the pure observation state model**

Create `observation-state.ts`:

```ts
export type ObservationComponent = {
  provider: string | null;
  externalRef: string | null;
  containerName: string | null;
  updatedAt: Date;
};

export type ObservationContext = {
  accounts: Array<{
    id: string;
    provider: 'vercel' | 'supabase';
    lastSyncAt: Date | null;
    lastError: string | null;
  }>;
  activeJobs: Array<{ type: string; payload: Record<string, unknown> }>;
  dockerLastSyncAt: Date | null;
};

export type MissingObservation = { label: string; detail: string | null };

function accountId(payload: Record<string, unknown>): string | null {
  return typeof payload.accountId === 'string' ? payload.accountId : null;
}

export function describeMissingObservation(
  component: ObservationComponent,
  context: ObservationContext,
): MissingObservation {
  if (component.containerName !== null) {
    if (context.activeJobs.some(({ type }) => type === 'docker.sync')) {
      return { label: '동기화 대기', detail: null };
    }
    return context.dockerLastSyncAt !== null
      && context.dockerLastSyncAt.getTime() >= component.updatedAt.getTime()
      ? { label: '관측되지 않음', detail: null }
      : { label: '동기화 필요', detail: null };
  }
  if (component.provider !== 'vercel' && component.provider !== 'supabase') {
    return { label: '연결 필요', detail: null };
  }
  const accounts = context.accounts.filter(
    ({ provider }) => provider === component.provider,
  );
  if (accounts.length === 0) return { label: '연결 필요', detail: null };
  const ids = new Set(accounts.map(({ id }) => id));
  if (context.activeJobs.some((job) => (
    job.type === `${component.provider}.sync`
    && ids.has(accountId(job.payload) ?? '')
  ))) {
    return { label: '동기화 대기', detail: null };
  }
  const newestSync = accounts.reduce<Date | null>((latest, account) => (
    account.lastError === null
      && account.lastSyncAt !== null
      && (latest === null || account.lastSyncAt.getTime() > latest.getTime())
      ? account.lastSyncAt
      : latest
  ), null);
  if (
    newestSync !== null
    && newestSync.getTime() >= component.updatedAt.getTime()
  ) {
    return { label: '관측되지 않음', detail: null };
  }
  const error = accounts.find(({ lastError }) => lastError !== null)?.lastError ?? null;
  return { label: '동기화 필요', detail: error };
}
```

- [ ] **Step 4: Pass state context through composition and render messages**

Add `externalRef`, `updatedAt`, and `observationContext` to `CompositionInput`. Add `message: string | null` to `CompositionObservation`. Observed resources set `message: null`; the empty branch calls `describeMissingObservation` and sets:

```ts
const missing = describeMissingObservation(component, observationContext);
const observations = observed.length > 0 ? observed : [{
  key: `${component.id}:unobserved`,
  name: null,
  provider: null,
  status: null,
  message: missing.detail === null
    ? missing.label
    : `${missing.label} · ${missing.detail}`,
}];
```

In `composition.tsx`, feed `Annotation` the message first:

```tsx
<Annotation
  value={observation.message ?? (
    observation.name === null
      ? null
      : [observation.name, observation.provider, observation.status]
          .filter(Boolean).join(' · ')
  )}
/>
```

Update existing composition test fixtures with `externalRef`, `updatedAt`, and an empty context. Add assertions for the four Korean state labels.

- [ ] **Step 5: Query provider accounts and active/latest jobs on the detail page**

In `page.tsx`, import `and`, `inArray`, and the observation context type. Add three promises to the existing `Promise.all`:

```ts
db.select({
  id: schema.providerAccounts.id,
  provider: schema.providerAccounts.provider,
  lastSyncAt: schema.providerAccounts.lastSyncAt,
  lastError: schema.providerAccounts.lastError,
}).from(schema.providerAccounts).where(inArray(
  schema.providerAccounts.provider,
  ['vercel', 'supabase'],
)),
db.select({
  type: schema.jobs.type,
  payload: schema.jobs.payload,
}).from(schema.jobs).where(and(
  inArray(schema.jobs.type, ['vercel.sync', 'supabase.sync', 'docker.sync']),
  inArray(schema.jobs.status, ['pending', 'running']),
)),
db.select({ updatedAt: schema.jobs.updatedAt })
  .from(schema.jobs)
  .where(and(eq(schema.jobs.type, 'docker.sync'), eq(schema.jobs.status, 'succeeded')))
  .orderBy(desc(schema.jobs.updatedAt))
  .limit(1),
```

Narrow provider account rows to `vercel | supabase`, construct `observationContext`, and pass component `externalRef`, `updatedAt`, and the context into `buildComposition`.

- [ ] **Step 6: Add page-source regression assertions**

In `page.test.ts`, assert the detail page reads `providerAccounts`, active `jobs`, the latest successful `docker.sync`, and passes `observationContext` to `buildComposition`. This prevents a future UI refactor from silently returning every missing observation to a blank dash.

Use source assertions that bind the state model to real database facts:

```ts
expect(page).toContain('schema.providerAccounts.lastSyncAt');
expect(page).toContain('schema.providerAccounts.lastError');
expect(page).toContain("['vercel.sync', 'supabase.sync', 'docker.sync']");
expect(page).toContain("eq(schema.jobs.status, 'succeeded')");
expect(page).toContain("eq(schema.jobs.type, 'docker.sync')");
expect(page).toContain('observationContext');
expect(page).toContain('externalRef: component.externalRef');
expect(page).toContain('updatedAt: component.updatedAt');
```

- [ ] **Step 7: Run project detail tests and web typecheck**

Run: `pnpm exec vitest run apps/web/src/app/projects/[slug]/observation-state.test.ts apps/web/src/app/projects/[slug]/composition.test.ts apps/web/src/app/projects/[slug]/page.test.ts && pnpm --filter web typecheck`

Expected: all project detail tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit project observation states**

```bash
git add apps/web/src/app/projects/[slug]/observation-state.ts apps/web/src/app/projects/[slug]/observation-state.test.ts apps/web/src/app/projects/[slug]/composition-model.ts apps/web/src/app/projects/[slug]/composition.tsx apps/web/src/app/projects/[slug]/composition.test.ts apps/web/src/app/projects/[slug]/page.tsx apps/web/src/app/projects/[slug]/page.test.ts
git commit -m "feat: explain missing project observations"
```

### Task 9: Run end-to-end verification gates

**Files:**
- Verify only; modify files only to fix a demonstrated regression.

- [ ] **Step 1: Run focused feature tests**

Run:

```bash
pnpm exec vitest run packages/collectors/src/supabase/normalize.test.ts packages/collectors/src/supabase/index.test.ts apps/web/src/lib/declared-link.test.ts apps/worker/src/handlers/supabase-sync.test.ts apps/worker/src/index.test.ts apps/web/src/actions/providers.test.ts apps/web/src/app/settings/providers/providers-page.test.ts apps/web/src/actions/drafts.test.ts apps/web/src/app/projects/[slug]/observation-state.test.ts apps/web/src/app/projects/[slug]/composition.test.ts apps/web/src/app/projects/[slug]/page.test.ts --maxWorkers=1
```

Expected: every named test file PASS.

- [ ] **Step 2: Run the full test suite with one worker**

Run: `pnpm exec vitest run --maxWorkers=1`

Expected: all test files and tests PASS. Keep `--maxWorkers=1` on this Windows Docker Desktop host because parallel Testcontainers exhausted the daemon during baseline setup; baseline was 101 files and 1,059 tests passing.

- [ ] **Step 3: Run repository typechecks**

Run: `pnpm typecheck`

Expected: every workspace package exits 0.

- [ ] **Step 4: Run production builds**

Run: `pnpm --filter worker build && pnpm --filter web build`

Expected: both production builds exit 0 using the already configured non-secret environment.

- [ ] **Step 5: Inspect security and schema boundaries**

Run:

```bash
rg -n "service_role|database.*password|authorization|encryptedToken|raw response" packages/collectors/src/supabase apps/worker/src/handlers/supabase-sync.ts apps/web/src/actions/providers.ts
git diff --check
git status --short
```

Expected: PAT appears only in the Authorization header and encryption path; no provider response secret field is persisted; `git diff --check` exits 0; only intended feature files are modified.

- [ ] **Step 6: Perform a local UI smoke test**

Run the configured web/worker stack, then verify:

1. `/settings/providers` shows the Supabase PAT form, privilege warning, safe suffix, last sync/error, and manual sync.
2. A valid PAT creates one `supabase` provider account and one active `supabase.sync` job without displaying the PAT.
3. A Draft with exact Vercel ID, Docker container name, and Supabase project ref shows existing observations immediately after approval.
4. The detail page shows `연결 필요`, `동기화 대기`, `동기화 필요`, and `관측되지 않음` only under their documented conditions.

- [ ] **Step 7: Close any demonstrated verification defect in its owning task**

If Step 1-6 demonstrates a defect, return to the task that owns that exact file, add a failing regression assertion there, rerun its focused command, apply the minimal fix, rerun the full failing gate, and amend that task's commit. If no changes are required, do not create an empty commit.

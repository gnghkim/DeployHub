# DeployHub M1c (CLI 자동등록) Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** 구축방안 29장의 핵심 사용방식을 실제로 동작시킨다 — 사용자가 AI에게 "현재 프로젝트를 DeployHub에 등록해줘"라고 지시하면, CLI가 프로젝트를 분석해 `deployhub.yaml`을 만들고 검증한 뒤 Draft로 제출하고, 사람이 관리화면에서 승인한다.

**Architecture:** Zod 스키마 하나가 manifest의 유일한 진실원천이다. 서버가 그것을 JSON Schema로 변환해 배포하고, CLI는 스키마를 자체 보관하지 않고 실행 시 서버에서 받는다. 등록은 10분·1회용 토큰으로 인증하고, 제출된 것은 반드시 Draft를 거쳐 사람 승인 후 Active가 된다.

**Tech Stack:** Zod 4 (native `z.toJSONSchema()`) · commander 15 · yaml 2 · Drizzle · Vitest · Testcontainers

**선행 문서:** `docs/superpowers/specs/2026-07-26-deployhub-구축방안.md` (§29–47), M1a·M1b 계획서

---

## M1a·M1b에서 확정된 전제

| 항목 | 확정 내용 |
|---|---|
| 버전 | Node 22.23.1 · pnpm 9.15.0 · TypeScript 6.0.3 · Vitest 4.1.10 · PostgreSQL 17.10 · Next 16.2.12 · Zod 4.4.3 |
| 워크스페이스 | `apps/web`, `apps/worker`, `packages/shared`, `packages/db`, `packages/collectors` |
| DB 스키마 | 테이블 7개. `projects.repository`(nullable, non-unique), `components.field_sources JSONB`, `component_resources.linked_by` |
| 배포 | 공용 VPS. 공용 Caddy가 `hub.nolzza.net` → `deployhub-web:3000` 프록시. 우리는 호스트 포트를 열지 않는다 |
| 인증 | Auth.js GitHub OAuth + `isAllowedLogin` fail-closed |
| 암호화 | `packages/shared`의 `encrypt`/`decrypt` (AES-256-GCM) |

**운영 중이다.** 이 마일스톤의 변경은 실제 서비스에 배포된다. 마이그레이션은 되돌리기 어려우므로 스키마 변경에 특히 주의한다.

---

## Global Constraints

M1a·M1b의 Global Constraints를 그대로 승계하고 아래를 더한다.

- **상대 import에 확장자를 붙이지 않는다.**
- **새 패키지는 `package.json` → `tsconfig.json` → 설치 순.** 내부 패키지는 `workspace:*` 명시.
- **새 `tsconfig.json`은 `{ extends, compilerOptions: { noEmit: true }, include }` 형태.** `rootDir`/`outDir` 금지.
- **모든 Zod 문자열 필드에 `.trim()`을 적용한다.** M1b에서 이걸 빠뜨려 `[ worker]`가 저장됐다. **AI가 생성한 YAML은 사람이 눈으로 볼 기회조차 없으므로 여기서는 더 치명적이다.**
- **토큰은 평문으로 저장·로그·응답에 남기지 않는다.** DB에는 SHA-256 해시만.
- **`docs/`는 각 Task의 산출물이 아니다.** 건드리지 않는다.
- **커밋 메시지:** Conventional Commits.

---

## 구축방안 대비 결정

| 항목 | 구축방안 | M1c 결정 | 근거 |
|---|---|---|---|
| JSON Schema 변환 | `zod-to-json-schema` 암시 | **Zod 4 native `z.toJSONSchema()`** | 4.4.3에 내장돼 있음을 실제 확인했다. 의존성 하나를 줄인다 |
| 탐지 근거의 위치 | 34.2가 `deployhub.yaml` 안에 `detection:` 블록을 보여준다 | **yaml에 넣지 않는다.** CLI가 Draft 제출 본문에 `fieldSources`로 따로 보낸다 | `deployhub.yaml`은 git에 커밋되어 사람이 읽고 고치는 파일이다. 필드마다 탐지 근거가 붙으면 읽을 수 없게 된다. DB의 `components.field_sources`는 제출 본문에서 채운다 |
| Device Login · OIDC · MCP | 38.3 · 40 · 41 | **M5 이후** | 구축방안이 이미 보류로 잡은 항목 |
| `deployhub sync --draft` · `diff` | 33.2 | **M1c 포함** | 기존 프로젝트 갱신이 없으면 두 번째 실행부터 쓸 수 없다 |
| `manifest upgrade` | 31.3 | **골격만** | v1 하나뿐이라 변환할 대상이 없다. 명령과 버전 협상 경로만 만든다 |

---

## Manifest v1 스키마 (확정)

`deployhub.yaml`은 **선언만** 담는다. 관측값(현재 실행 상태, 최근 배포)은 들어가지 않는다.

```yaml
# yaml-language-server: $schema=https://hub.nolzza.net/schemas/deployhub-v1.json
apiVersion: deployhub.io/v1
kind: Project

metadata:
  name: DeployHub
  slug: deployhub
  description: 통합 프로젝트·인프라 관리 시스템

spec:
  lifecycle: production
  importance: 4
  owner: gnghkim

  repository:
    provider: github
    slug: gnghkim/DeployHub

  components:
    - name: web
      type: frontend
      framework: nextjs
      runtime: nodejs
      language: typescript
      criticality: 4
      path: apps/web
    - name: worker
      type: worker
      runtime: nodejs
      language: typescript
      criticality: 3
      path: apps/worker
    - name: database
      type: database
      runtime: postgresql
      criticality: 5

  domains:
    - domain: hub.nolzza.net
      environment: production

  documents:
    - type: readme
      path: README.md
```

**DB 매핑**

| manifest | DB |
|---|---|
| `metadata.name/slug/description` | `projects.name/slug/description` |
| `spec.lifecycle/importance/owner` | `projects.lifecycle/importance/owner` |
| `spec.repository.slug` | `projects.repository` |
| `spec.components[]` | `components` 행 (`name`, `slug`=name, `component_type`=`type`, …) |
| `spec.domains[]` | `domains` 행 |
| `spec.documents[]` | **M1c에서 저장하지 않는다.** `documents` 테이블이 없다. 스키마에는 두되 승인 시 무시하고, 그 사실을 검증 결과에 경고로 남긴다 |

`projects.status`는 manifest에 없다. 운영 상태이지 선언이 아니다. 신규 생성 시 `active`가 기본이다.

`components.slug`는 `name`을 그대로 쓴다. manifest에 별도 slug를 두지 않는다 — 사람이 두 개를 관리할 이유가 없고, `(project_id, slug)` unique는 `name`으로도 충족된다. `name`은 slug 규칙(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)을 만족해야 한다.

---

## File Structure

```
packages/
├─ manifest/                      (신규)
│  ├─ package.json  tsconfig.json
│  └─ src/
│     ├─ index.ts                 재export
│     ├─ schema.ts                Zod v1 — 유일한 진실원천
│     ├─ json-schema.ts           z.toJSONSchema() 래퍼
│     ├─ parse.ts                 YAML → 검증 결과
│     ├─ diff.ts                  manifest ↔ DB 현재값 비교
│     └─ *.test.ts
└─ cli/                           (신규)
   ├─ package.json  tsconfig.json
   └─ src/
      ├─ index.ts                 commander 진입점
      ├─ commands/{init,validate,register,diff,sync,status}.ts
      ├─ detectors/{index,node,docker,github,database}.ts
      ├─ schema-client.ts         서버에서 스키마 조회 + ETag 캐시
      ├─ api.ts                   Draft 제출 클라이언트
      └─ *.test.ts

packages/db/src/
├─ schema/registration.ts         registration_tokens, project_drafts (신규)
└─ queries/drafts.ts              (신규)

apps/web/src/
├─ app/
│  ├─ schemas/deployhub-v1.json/route.ts   정적 JSON Schema
│  ├─ api/v1/manifest/{schema,template}/route.ts
│  ├─ api/v1/manifest/validate/route.ts
│  ├─ api/v1/project-drafts/route.ts       토큰 인증 제출
│  ├─ settings/tokens/page.tsx             등록 토큰 발급
│  └─ drafts/{page.tsx,[id]/page.tsx}      Draft 검토·승인
├─ actions/{tokens,drafts}.ts
└─ lib/token.ts                            해시·검증

AGENTS.md                          (신규) AI 작업 지침
deployhub.yaml                     (신규) DeployHub 자신의 manifest
```

---

## Task 1: manifest 패키지와 Schema API

**Files:**
- Create: `packages/manifest/{package.json,tsconfig.json}`
- Create: `packages/manifest/src/{index,schema,json-schema,parse}.ts`
- Create: `packages/manifest/src/{schema,parse,json-schema}.test.ts`
- Create: `packages/manifest/test/fixtures/{valid,invalid-*}.yaml`
- Create: `apps/web/src/app/schemas/deployhub-v1.json/route.ts`
- Create: `apps/web/src/app/api/v1/manifest/{schema,template}/route.ts`
- Create: `apps/web/src/app/api/v1/manifest/validate/route.ts`

**Interfaces:**
- Consumes: 없음 (신규 패키지)
- Produces:

```ts
export const MANIFEST_VERSION = 'deployhub.io/v1';
export const manifestSchema: z.ZodType<Manifest>;
export type Manifest = z.infer<typeof manifestSchema>;

export type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' };
export type ParseResult =
  | { ok: true; manifest: Manifest; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[] };

export function parseManifest(yamlText: string): ParseResult;
export function manifestJsonSchema(): Record<string, unknown>;
export function manifestTemplate(): string;   // 주석 포함 YAML 템플릿
```

- [ ] **Step 1: 패키지 생성** (순서 준수)

`packages/manifest/package.json`:

```json
{
  "name": "@deployhub/manifest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/manifest/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

```bash
pnpm --filter @deployhub/manifest add 'zod@^4.4.3' 'yaml@^2.9.0'
```

- [ ] **Step 2: 실패하는 스키마 테스트 작성** (구현보다 먼저)

`packages/manifest/src/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { manifestSchema } from './schema';

const base = {
  apiVersion: 'deployhub.io/v1',
  kind: 'Project',
  metadata: { name: 'DeployHub', slug: 'deployhub' },
  spec: {
    lifecycle: 'production',
    components: [{ name: 'web', type: 'frontend' }],
  },
};

describe('manifestSchema', () => {
  it('최소 유효 manifest 를 통과시킨다', () => {
    expect(manifestSchema.parse(base).metadata.slug).toBe('deployhub');
  });

  it('apiVersion 이 다르면 거부한다', () => {
    expect(() => manifestSchema.parse({ ...base, apiVersion: 'deployhub.io/v2' })).toThrow();
  });

  it('kind 가 Project 가 아니면 거부한다', () => {
    expect(() => manifestSchema.parse({ ...base, kind: 'Service' })).toThrow();
  });

  it('문자열 앞뒤 공백을 제거한다', () => {
    const m = manifestSchema.parse({
      ...base,
      metadata: { name: '  DeployHub  ', slug: 'deployhub', description: '  설명  ' },
    });
    expect(m.metadata.name).toBe('DeployHub');
    expect(m.metadata.description).toBe('설명');
  });

  it('공백만 있는 name 을 거부한다', () => {
    expect(() =>
      manifestSchema.parse({ ...base, metadata: { name: '   ', slug: 'deployhub' } }),
    ).toThrow();
  });

  it('slug 는 소문자·숫자·하이픈만 허용한다', () => {
    expect(() => manifestSchema.parse({ ...base, metadata: { name: 'X', slug: 'Deploy_Hub' } })).toThrow();
  });

  it('components 가 비어 있으면 거부한다', () => {
    expect(() => manifestSchema.parse({ ...base, spec: { ...base.spec, components: [] } })).toThrow();
  });

  it('component name 이 slug 규칙을 만족해야 한다', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: { ...base.spec, components: [{ name: 'Web App', type: 'frontend' }] },
      }),
    ).toThrow();
  });

  it('component name 이 중복되면 거부한다', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: {
          ...base.spec,
          components: [
            { name: 'web', type: 'frontend' },
            { name: 'web', type: 'api' },
          ],
        },
      }),
    ).toThrow();
  });

  it('component type 은 DB enum 11종만 허용한다', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: { ...base.spec, components: [{ name: 'gw', type: 'gateway' }] },
      }),
    ).toThrow();
    for (const t of [
      'frontend', 'backend', 'api', 'worker', 'scheduler', 'database',
      'authentication', 'storage', 'cache', 'queue', 'monitoring',
    ]) {
      expect(() =>
        manifestSchema.parse({
          ...base,
          spec: { ...base.spec, components: [{ name: 'c', type: t }] },
        }),
      ).not.toThrow();
    }
  });

  it('repository.slug 는 owner/name 형식만 허용한다', () => {
    const withRepo = (slug: string) =>
      manifestSchema.parse({
        ...base,
        spec: { ...base.spec, repository: { provider: 'github', slug } },
      });
    expect(withRepo('gnghkim/DeployHub').spec.repository?.slug).toBe('gnghkim/DeployHub');
    expect(() => withRepo('DeployHub')).toThrow();
  });

  it('importance 는 1~5 범위만 허용한다', () => {
    expect(() => manifestSchema.parse({ ...base, spec: { ...base.spec, importance: 6 } })).toThrow();
  });

  it('알 수 없는 최상위 키를 거부한다', () => {
    expect(() => manifestSchema.parse({ ...base, extra: true })).toThrow();
  });
});
```

마지막 테스트가 중요하다. `strict()`로 알 수 없는 키를 거부하면 AI가 만들어낸 존재하지 않는 필드가 조용히 무시되지 않는다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run packages/manifest`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 4: 스키마 구현**

`component_type` 11종은 `packages/db`의 `componentType` pgEnum과 **정확히 같아야 한다.** `packages/db/src/schema/enums.ts`를 직접 읽어 확인하라. 순서까지 맞춘다.

`.strict()`를 모든 객체에 적용한다. 문자열은 전부 `.trim()`. `components`의 `name` 중복은 `.refine()`으로 막는다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run packages/manifest`
Expected: PASS — 13 tests

- [ ] **Step 6: 실패하는 파서·JSON Schema 테스트 작성**

`parse.test.ts` — YAML 픽스처 기반. 검증할 것:
- 유효 YAML → `ok: true`
- YAML 문법 오류 → `ok: false`, 오류에 줄 번호 포함
- 스키마 위반 → `ok: false`, `path`가 `spec.components[0].type` 형태로 사람이 읽을 수 있을 것
- `spec.documents`가 있으면 `ok: true`이지만 warning 하나 (M1c는 저장하지 않음)
- 빈 문자열 입력 → `ok: false` (throw 하지 않는다)

`json-schema.test.ts` — 검증할 것:
- `$schema`가 draft 2020-12
- `properties.apiVersion`의 enum에 `deployhub.io/v1`이 있을 것
- `component_type` 11종이 전부 enum에 나타날 것
- 두 번 호출해도 같은 결과 (결정적)

- [ ] **Step 7: 실패 확인 → 구현 → 통과 확인**

Run: `pnpm vitest run packages/manifest`

- [ ] **Step 8: Schema API 라우트**

```bash
pnpm --filter web add '@deployhub/manifest@workspace:*'
```

네 라우트를 만든다. **모두 응답에 `X-Manifest-Version: deployhub.io/v1` 헤더를 붙인다.** CLI가 캐시 무효화 판단에 쓴다.

| 경로 | 메서드 | 인증 | 응답 |
|---|---|---|---|
| `/schemas/deployhub-v1.json` | GET | 없음 | JSON Schema. `Cache-Control: public, max-age=3600`, ETag |
| `/api/v1/manifest/schema` | GET | 없음 | 같은 JSON Schema |
| `/api/v1/manifest/template` | GET | 없음 | 주석 포함 YAML 템플릿 (`text/yaml`) |
| `/api/v1/manifest/validate` | POST | 없음 | 본문 YAML을 검증해 `ParseResult` 반환 |

**인증을 두지 않는 이유:** 스키마와 템플릿은 공개 정보다. IDE의 YAML Language Server가 `$schema` URL로 익명 조회해야 하고, 감출 것이 없다. `validate`는 입력을 저장하지 않고 판정만 돌려주므로 상태를 바꾸지 않는다.

**미들웨어 matcher에서 이 네 경로를 제외해야 한다.** 현재 matcher는 `api/auth` 외 전부를 인증 대상으로 잡으므로 그대로 두면 익명 조회가 307로 튕긴다. `apps/web/src/middleware.ts`의 matcher에 `schemas`와 `api/v1/manifest`를 추가한다.

`validate`에는 본문 크기 상한을 둔다 — 256KB를 넘으면 413. 레이트리밋이 없는 환경(구축방안 R12)에서 유일한 방어다.

- [ ] **Step 9: 라우트 테스트**

`validate`가 유효/무효 YAML에 각각 맞는 응답을 주는지, 크기 초과가 413인지, 네 경로가 인증 없이 200인지 확인한다.

- [ ] **Step 10: 전체 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`

미들웨어 변경을 실제로 확인하라 — 빌드만으로는 matcher가 맞는지 알 수 없다. 로컬에서 web을 띄우고 `/schemas/deployhub-v1.json`이 **307이 아니라 200**인지 확인한다.

```bash
git add -A && git commit -m "feat: manifest v1 스키마와 Schema API"
```

**게이트 통과 조건:** 스키마 테스트 13건 + 파서·JSON Schema 테스트 통과. `component_type` 11종이 DB enum과 일치. 네 경로가 인증 없이 200. 미들웨어 matcher가 이를 실제로 허용함을 기동해서 확인.

---

## Task 2: 등록 토큰과 Draft 스키마

**Files:**
- Create: `packages/db/src/schema/registration.ts`
- Create: `drizzle/0002_*.sql`
- Create: `packages/db/src/queries/drafts.ts`, `packages/db/src/queries/tokens.ts`
- Create: `packages/db/src/queries/{tokens,drafts}.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: M1a `Db`, `schema.users`
- Produces:

```ts
// schema
registrationTokens: token_hash, scope, repository_constraint, project_slug_constraint,
                    expires_at, max_uses, used_count, created_by, created_at, revoked_at
projectDrafts:      project_id(nullable), manifest_version, manifest_yaml, field_sources,
                    source_type, submitted_by_type, submitted_by_id, status,
                    validation_result, diff, reviewed_by, reviewed_at, created_at

// queries
export function hashToken(raw: string): string;                       // SHA-256 hex
export function issueToken(db, opts): Promise<{ raw: string; id: string }>;
export function consumeToken(db, raw: string): Promise<ConsumeResult>;
export function revokeToken(db, id: string): Promise<void>;
```

`ConsumeResult`는 `{ ok: true; tokenId: string; scope: string; repositoryConstraint: string | null }` 또는 `{ ok: false; reason: 'not_found' | 'expired' | 'exhausted' | 'revoked' }`.

- [ ] **Step 1: 실패하는 토큰 테스트 작성** (구현보다 먼저)

이 카드의 핵심이다. 토큰은 인증 수단이므로 경계 조건이 전부 테스트로 고정돼야 한다.

`packages/db/src/queries/tokens.test.ts` — 검증할 것:

1. 발급된 원문으로 `consumeToken`이 성공한다
2. **DB에 원문이 저장되지 않는다** — `select * from registration_tokens`의 어떤 컬럼에도 원문이 없다
3. 잘못된 토큰은 `not_found`
4. `expires_at`이 지난 토큰은 `expired`
5. `max_uses: 1` 토큰을 두 번 쓰면 두 번째는 `exhausted`
6. `revoked_at`이 채워진 토큰은 `revoked`
7. **동시에 두 번 consume하면 하나만 성공한다** — `Promise.all`로 동시 호출해 성공이 정확히 1건
8. 발급 원문이 `dh_reg_` 접두사를 갖고 32바이트 이상의 무작위를 포함한다
9. 같은 옵션으로 두 번 발급하면 원문이 다르다

7번이 가장 중요하다. 단일 사용을 애플리케이션 코드에서 확인하고 나중에 갱신하면 경쟁 조건이 생긴다. **하나의 `UPDATE ... WHERE used_count < max_uses ... RETURNING`으로 원자적으로 처리해야 한다.** M1a Task 3의 `SKIP LOCKED`와 같은 종류의 문제다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/db/src/queries`
Expected: FAIL

- [ ] **Step 3: 스키마 구현**

```ts
export const draftStatus = pgEnum('draft_status', [
  'draft', 'validation_failed', 'pending_review', 'approved', 'rejected', 'superseded',
]);
export const draftSourceType = pgEnum('draft_source_type', ['cli', 'manual']);
export const submitterType = pgEnum('submitter_type', ['token', 'user']);
```

`registration_tokens.token_hash`는 `unique`. `project_drafts.project_id`는 nullable(신규 프로젝트는 아직 없음)이며 `on delete cascade`.

**enum 이름이 기존과 충돌하지 않는지 확인하라.** `status`처럼 흔한 이름을 쓰지 말고 위 세 개를 그대로 쓴다.

- [ ] **Step 4: 마이그레이션 생성**

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`

**생성된 SQL을 반드시 읽어라.** 운영 DB에 적용될 것이다. 기존 7개 테이블을 변경하는 문장이 있으면 멈추고 보고하라 — 이 Task는 테이블 2개와 enum 3개를 **추가**할 뿐이다.

- [ ] **Step 5: 쿼리 구현 → 통과 확인**

Run: `pnpm vitest run packages/db`
Expected: 토큰 9건 + 기존 테스트 통과

- [ ] **Step 6: Draft 쿼리와 테스트**

`listDrafts`, `getDraft`, `insertDraft`, `updateDraftStatus`. 검증할 것:
- 제출된 Draft가 `pending_review`로 저장된다
- 검증 실패한 제출은 `validation_failed`로 저장된다 (**버리지 않는다** — 왜 실패했는지 화면에서 봐야 한다)
- 같은 slug에 새 Draft가 오면 기존 `pending_review`가 `superseded`가 된다

- [ ] **Step 7: 커밋**

**게이트 통과 조건:** 토큰 테스트 9건 전부 통과, 특히 동시 consume 테스트. 마이그레이션이 기존 테이블을 변경하지 않을 것. DB에 토큰 원문이 없을 것.

---

## Task 3: Draft 제출 API와 승인 화면

**Files:**
- Create: `apps/web/src/app/api/v1/project-drafts/route.ts`
- Create: `apps/web/src/lib/token.ts`
- Create: `apps/web/src/actions/{tokens,drafts}.ts`
- Create: `apps/web/src/app/settings/tokens/page.tsx`
- Create: `apps/web/src/app/drafts/{page.tsx,[id]/page.tsx}`
- Create: `packages/manifest/src/diff.ts`, `diff.test.ts`
- Create: 위 각 파일의 테스트

**Interfaces:**
- Consumes: Task 1 `parseManifest`, Task 2 `consumeToken`·Draft 쿼리
- Produces:

```ts
export type ManifestDiff = {
  project: { field: string; from: string | null; to: string | null }[];
  componentsAdded: string[];
  componentsChanged: { name: string; field: string; from: string | null; to: string | null }[];
  componentsRemoved: string[];   // manifest 에 없지만 DB 에 있는 것
  domainsAdded: string[];
  domainsRemoved: string[];
};
export function diffManifest(manifest: Manifest, current: ProjectDetail | undefined): ManifestDiff;

// Server Actions
export async function issueRegistrationToken(formData): Promise<TokenActionState>;
export async function approveDraft(id: string): Promise<void>;
export async function rejectDraft(id: string): Promise<void>;
```

- [ ] **Step 1: 실패하는 diff 테스트 작성**

검증할 것:
- 신규 프로젝트(현재값 없음) → 모든 구성요소가 `componentsAdded`
- 필드 변경 → `project`에 `from`/`to`
- manifest에 없는 기존 구성요소 → `componentsRemoved` (**자동 삭제하지 않는다.** 승인 화면에서 사람이 보고 판단한다)
- 변경 없음 → 모든 배열이 빈 상태
- 구성요소 순서만 바뀐 경우 변경으로 잡지 않는다 (이름 기준 비교)

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 실패하는 제출 API 테스트 작성**

`POST /api/v1/project-drafts`는 **세션이 아니라 토큰으로 인증한다.** 새로운 공개 엔드포인트이므로 경계를 테스트로 고정한다.

검증할 것:
1. 유효 토큰 + 유효 manifest → 201, `pending_review` Draft 생성
2. **토큰 없음 → 401.** DB 조회 전에 거부
3. 잘못된 토큰 → 401
4. 만료 토큰 → 401
5. 이미 쓴 토큰 → 401
6. 유효 토큰 + 무효 manifest → 201이지만 `validation_failed` 상태. **토큰은 소비된다** (재시도로 무한히 검증을 돌릴 수 없게)
7. `repository_constraint`가 걸린 토큰에 다른 저장소 manifest → 403
8. 본문 256KB 초과 → 413
9. **응답 본문에 토큰이 반향되지 않는다**
10. 제출은 `projects`/`components`를 직접 바꾸지 않는다 — 승인 전에는 Draft만 생긴다

10번이 구축방안 39장의 핵심이다. **AI가 제출한 것은 절대 바로 Active가 되지 않는다.**

- [ ] **Step 4: 실패 확인 → 구현 → 통과 확인**

토큰은 `Authorization: Bearer dh_reg_...` 헤더로 받는다. **쿼리스트링으로 받지 않는다**(구축방안 38.1). 미들웨어 matcher에서 이 경로를 제외한다.

- [ ] **Step 5: 승인 화면과 Action**

토큰 발급 화면(`/settings/tokens`) — 발급 시 **원문을 한 번만 보여준다.** 이후에는 볼 수 없다. 만료·사용 여부·폐기 버튼을 표시한다.

Draft 검토 화면(`/drafts/[id]`) — 구축방안 39.1을 따라 보여준다.
- 신규·변경·삭제 예정 항목 (Task 1의 diff)
- 검증 오류·경고
- `field_sources`에서 `inferred`·`unknown`인 항목 **강조**
- 승인 / 거부 버튼

승인 Action은 **트랜잭션 하나로** projects·components·domains에 적용한다. 부분 적용이 남으면 안 된다.

`componentsRemoved`는 **자동 삭제하지 않는다.** 화면에서 "manifest에 없음"으로 표시하고, 사람이 개별 삭제하도록 둔다. AI가 실수로 구성요소를 빠뜨린 manifest를 보냈을 때 승인 한 번으로 데이터가 사라지면 안 된다.

- [ ] **Step 6: 승인 Action 테스트**

검증할 것: 세션 없이 승인 불가, 승인이 신규 프로젝트를 만든다, 승인이 기존 프로젝트를 갱신한다, `componentsRemoved`가 자동 삭제되지 않는다, 승인된 Draft는 다시 승인되지 않는다.

- [ ] **Step 7: 전체 검증과 커밋**

**게이트 통과 조건:** 제출 API 테스트 10건 전부 통과. 특히 2·6·10번. 승인이 트랜잭션일 것. `componentsRemoved` 자동 삭제 없을 것.

---

## Task 4: CLI 골격과 detectors

**Files:**
- Create: `packages/cli/{package.json,tsconfig.json}`
- Create: `packages/cli/src/{index,schema-client,api}.ts`
- Create: `packages/cli/src/commands/{init,validate}.ts`
- Create: `packages/cli/src/detectors/{index,node,docker,github,database}.ts`
- Create: `packages/cli/src/detectors/*.test.ts`
- Create: `packages/cli/test/fixtures/` (프로젝트 폴더 픽스처)

**Interfaces:**
- Consumes: Task 1 `@deployhub/manifest`
- Produces:

```ts
export type FieldSource = {
  origin: 'declared' | 'detected' | 'inferred' | 'unknown';
  evidence?: string;
  source?: string;
};
export type DetectionResult = {
  manifest: Partial<Manifest>;
  fieldSources: Record<string, Record<string, FieldSource>>;  // componentName -> field -> source
  notes: string[];
};
export function detectProject(rootDir: string): Promise<DetectionResult>;
```

- [ ] **Step 1: 패키지 생성** (순서 준수)

```bash
pnpm --filter @deployhub/cli add '@deployhub/manifest@workspace:*' 'commander@^15.0.0' 'yaml@^2.9.0' 'zod@^4.4.3'
```

`package.json`에 `"bin": { "deployhub": "./dist/index.js" }`와 `"build": "tsup src/index.ts --format esm --out-dir dist --target node22"`를 둔다. tsup은 devDependency다.

- [ ] **Step 2: 픽스처와 실패하는 detector 테스트 작성**

`packages/cli/test/fixtures/` 아래에 실제 프로젝트를 닮은 폴더 셋을 만든다.

```
nextjs-monorepo/   pnpm-workspace.yaml, apps/web/package.json(next), apps/worker/package.json, compose.yaml
python-api/        pyproject.toml(fastapi), Dockerfile, requirements.txt
plain-node/        package.json(express), .github/workflows/ci.yml
```

검증할 것:
- `nextjs-monorepo` → `web`(frontend/nextjs/nodejs/typescript)과 `worker`(worker/nodejs) 탐지
- `python-api` → `api`(api/fastapi/python) 탐지
- `plain-node` → `backend`(express) 탐지
- `compose.yaml`의 서비스가 구성요소 후보로 잡힌다
- `prisma/schema.prisma` 또는 `drizzle.config.*` 있으면 `database` 구성요소 추가
- **`fieldSources`가 채워진다** — 탐지된 필드는 `detected`이고 `evidence`에 근거(`next@16.2.12` 등)가 있다
- 판단 못 한 필드는 `unknown`이며, 억지로 값을 만들지 않는다
- git remote에서 `repository.slug`를 뽑는다. remote가 없으면 `unknown`
- **비밀값을 읽지 않는다** — `.env`를 열지 않고 `.env.example`의 **키 이름만** 본다. 테스트로 고정하라: `.env`에 값을 심어놓고 결과에 그 값이 나타나지 않음을 단언

마지막이 중요하다. M1b Task 4에서 같은 원칙을 지켰고 여기서도 어겨서는 안 된다.

- [ ] **Step 3: 실패 확인 → 구현 → 통과 확인**

M1b의 `packages/fingerprint`는 **아직 없다**(M2 예정). 지금은 CLI 안에 규칙을 두되, M2에서 공용 패키지로 뽑아낼 수 있도록 `detectors/index.ts`의 규칙 테이블을 데이터로 분리해 둔다.

- [ ] **Step 4: schema-client 구현과 테스트**

CLI는 **스키마를 자체 보관하지 않는다.** 실행 시 서버에서 받는다(구축방안 32장).

검증할 것:
- 서버에서 스키마를 받아 캐시한다
- `X-Manifest-Version`이 캐시와 다르면 캐시를 버리고 재조회한다
- 서버에 닿지 못하면 **캐시가 있어도 경고를 출력한다** — 조용히 낡은 스키마로 검증하지 않는다
- 캐시도 없고 서버도 안 되면 명확한 오류로 실패한다

캐시 위치는 `~/.cache/deployhub/schema-v1.json`. 만료는 1시간.

- [ ] **Step 5: `init --detect`와 `validate` 구현**

`deployhub init --detect` — 탐지 후 `deployhub.yaml`을 쓴다. 이미 있으면 덮어쓰지 않고 `--force`를 요구한다. `# yaml-language-server: $schema=...` 헤더를 첫 줄에 넣는다.

`deployhub validate` — 로컬 `deployhub.yaml`을 서버 스키마로 검증한다. `--remote`를 주면 `POST /api/v1/manifest/validate`로 서버 판정도 받아 비교한다.

출력에 `inferred`·`unknown` 항목을 **눈에 띄게** 표시한다. 구축방안 34.3이 요구하는 것이고, 사용자가 승인 전에 확인해야 하는 지점이다.

- [ ] **Step 6: 전체 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter @deployhub/cli build`

**게이트 통과 조건:** detector 테스트 통과, 특히 `.env` 값 미노출. schema-client가 오프라인에서 조용히 낡은 스키마를 쓰지 않을 것.

---

## Task 5: register/diff/sync와 AI 지침

**Files:**
- Create: `packages/cli/src/commands/{register,diff,sync,status}.ts`
- Create: `packages/cli/src/commands/*.test.ts`
- Create: `AGENTS.md`
- Create: `deployhub.yaml` (DeployHub 자신의 manifest)
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 제출 API, Task 4 detector·schema-client

- [ ] **Step 1: 실패하는 명령 테스트 작성**

검증할 것:
- `register --draft`가 `DEPLOYHUB_TOKEN` 환경변수에서 토큰을 읽는다
- **토큰을 인자로 받지 않는다** — `--token <값>` 옵션이 존재하지 않아야 한다(셸 히스토리 유출 방지, 구축방안 38.2)
- 토큰이 없으면 명확한 오류로 실패한다
- 제출 성공 시 Draft URL을 출력한다
- **토큰을 로그나 오류 메시지에 출력하지 않는다** — 테스트로 고정
- 검증 실패한 manifest는 제출하지 않고 로컬에서 먼저 막는다
- `diff`가 서버의 현재 선언과 로컬 manifest를 비교해 출력한다
- `status`가 등록·연결 상태를 출력한다

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

`sync --draft`는 `register --draft`와 같은 엔드포인트를 쓴다. 차이는 기존 프로젝트가 있을 때 diff를 함께 보내는 것뿐이다. 별도 명령으로 두는 이유는 사용자 의도를 분명히 하기 위함이다.

- [ ] **Step 3: `AGENTS.md` 작성**

구축방안 35.1을 따르되 실제 명령으로 채운다. 이 파일이 AI가 읽는 지침이므로 정확해야 한다.

포함할 것: 신규 등록 절차, 기존 갱신 절차, "YAML 구조를 추측하지 말고 CLI가 제공하는 스키마를 쓸 것", "장기 토큰·비밀값을 파일이나 대화에 기록하지 말 것", 토큰은 환경변수로만 전달.

- [ ] **Step 4: DeployHub 자신의 `deployhub.yaml` 생성**

CLI로 만든다. 손으로 쓰지 마라 — CLI가 실제로 동작하는지 검증하는 것이 목적이다.

```bash
pnpm --filter @deployhub/cli build
node packages/cli/dist/index.js init --detect
```

생성된 것을 검토해 `inferred`·`unknown`을 손으로 채운다. `database` 구성요소는 `postgres:17-alpine`이라 파일에서 탐지되지 않을 수 있으므로 그렇다면 손으로 추가한다.

**보고에 생성된 `deployhub.yaml` 전문과, 탐지가 놓친 필드 목록을 적어라.** 그것이 detector의 실제 정확도다.

- [ ] **Step 5: 전체 검증과 커밋**

**게이트 통과 조건:** `--token` 옵션이 존재하지 않을 것. 토큰이 로그·오류에 남지 않을 것. `deployhub.yaml`이 CLI로 생성됐을 것. `AGENTS.md`의 명령이 실제로 동작하는 것일 것.

---

## Self-Review

**1. 구축방안 커버리지**

| 구축방안 항목 | Task |
|---|---|
| 29장 전체 등록 흐름 | 1–5 |
| 31 Manifest 설계 | 1 |
| 32 Schema 제공 API | 1 |
| 33 CLI 명령 | 4, 5 |
| 34 프로젝트 자동 탐지 + 신뢰도 | 4 |
| 35 AGENTS.md | 5 |
| 38.2 일회용 등록 토큰 | 2, 3 |
| 39 Draft 승인 Workflow | 3 |
| 42 인증 관련 테이블 | 2 |
| 43 AI 등록 관련 API | 1, 3 |
| 38.3 Device Login · 40 OIDC · 41 MCP | **M5 이후** |

**2. 타입 일관성**

- `Manifest` — Task 1 정의, Task 3·4·5 소비 ✓
- `component_type` 11종 — Task 1이 DB pgEnum과 일치시킴을 명시 ✓
- `FieldSource` — Task 4 정의, Task 3의 승인 화면이 `components.field_sources`로 저장 ✓
- `ManifestDiff` — Task 3 정의, Task 5의 `diff` 명령이 소비 ✓
- `ConsumeResult` — Task 2 정의, Task 3의 제출 API가 소비 ✓

**3. 위험 지점**

- **토큰 단일 사용의 경쟁 조건** (Task 2 Step 1의 7번). 애플리케이션에서 확인 후 갱신하면 깨진다. 원자적 `UPDATE ... RETURNING` 필수.
- **새 공개 엔드포인트 5개.** 레이트리밋이 없는 환경(R12)이므로 본문 크기 상한과 토큰 필수를 테스트로 고정한다. 스키마·템플릿은 감출 것이 없고, `validate`는 상태를 바꾸지 않으며, 제출은 토큰 없이 401이다.
- **미들웨어 matcher.** 현재 `api/auth` 외 전부를 인증 대상으로 잡는다. 새 경로를 제외하지 않으면 익명 조회가 307로 튕긴다. **빌드로는 안 잡히므로 기동해서 확인한다.**
- **운영 DB 마이그레이션.** 테이블 2개·enum 3개 추가뿐이어야 한다. 생성된 SQL을 읽어 기존 테이블 변경이 없음을 확인한다.
- **승인의 원자성.** projects·components·domains를 하나의 트랜잭션으로 적용한다.
- **`componentsRemoved` 자동 삭제 금지.** AI가 구성요소를 빠뜨린 manifest를 보냈을 때 승인 한 번으로 데이터가 사라지면 안 된다.
- **`.env` 값 유입.** detector가 `.env`를 열지 않고 `.env.example`의 키 이름만 본다. 테스트로 고정.

**4. M1a·M1b에서 배운 것의 반영**

- 모든 Zod 문자열에 `.trim()` (Global Constraints) — M1b에서 빠뜨려 `[ worker]`가 저장됐다
- 새 패키지는 `package.json` → `tsconfig` → 설치 순 (Global Constraints)
- `workspace:*` 명시, 확장자 없는 import, `rootDir`/`outDir` 없는 tsconfig
- `components`를 배열로 두어 모노레포 다중 구성요소를 전제 — M1b 화면이 막았던 구조
- Zod 4 native `z.toJSONSchema()` 확인 완료 — 별도 패키지 불필요
- 의존성 버전 실측: commander 15.0.0 · yaml 2.9.0
- 미들웨어 matcher는 빌드로 안 잡히니 기동 확인을 Step에 명시

---

## Execution

orca orchestration + codex 위임. Task 1 → 2 → 3 → 4 → 5 순서.

Task 1이 3·4의 선행, Task 2가 3의 선행, Task 3·4가 5의 선행이므로 병렬화하지 않는다.

각 Task는 격리 worktree에서 수행하고, 검증 통과 후 코디네이터 검토를 거쳐 main에 병합한다. 디스패치 후 프롬프트 제출 여부를 터미널로 확인하고, 질문에는 중복본까지 답한 뒤 미읽음 0을 확인하고 대기로 넘어간다.

**Task 2 병합 후에는 운영 서버에 마이그레이션을 적용한다.** 코드만 배포하고 마이그레이션을 잊으면 web이 없는 테이블을 조회한다.

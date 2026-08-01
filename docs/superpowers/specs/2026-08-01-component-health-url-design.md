# Component Health URL Design

## Context

DeployHub currently treats every declared component URL and project domain as an
HTTP health-check target. This produces false incidents when a healthy API
intentionally returns `404` at its origin root while exposing a dedicated
readiness endpoint. The Yield API demonstrates the problem:

- `https://api.yield.ktgobiz.co.kr` returns `404`.
- `https://api.yield.ktgobiz.co.kr/health/ready` returns `200` after checking
  PostgreSQL connectivity.
- DeployHub records the root response as `health_status = down (404)` and judges
  the project as `장애`.

## Goals

- Let a component declare an explicit, verified HTTP(S) health-check URL.
- Preserve the existing behavior for manifests that do not declare one.
- Avoid checking a domain root when a more specific component health URL covers
  the same origin.
- Keep domain TLS monitoring unchanged.
- Carry the field through validation, draft review, approval, database storage,
  manifest retrieval, and manifest diffing.
- Update the Yield manifest to check its database-backed readiness endpoint.

## Non-goals

- Configurable methods, headers, bodies, authentication, intervals, timeouts, or
  expected response payloads.
- Relative health paths or URL joining rules.
- Changing the current rule that HTTP `200` through `399` is up and other HTTP
  responses are down.
- Changing Docker health or TLS certificate collection.
- Adding an application route to Yield solely for DeployHub monitoring.

## Manifest contract

Each component may include an optional `healthUrl` field next to `url`:

```yaml
- name: api
  type: api
  url: https://api.yield.ktgobiz.co.kr
  healthUrl: https://api.yield.ktgobiz.co.kr/health/ready
```

`healthUrl` must be an absolute `http://` or `https://` URL. The manifest parser
trims surrounding whitespace and rejects other schemes, relative paths, empty
strings, and unknown keys through the existing strict component schema.

The generated JSON Schema, validation API, draft payload, approved manifest API,
CLI diff model, fixtures, and review UI all expose the same camel-case field.

## Persistence and approval

The `components` table gains a nullable `health_url` text column, represented as
`healthUrl` in TypeScript. A forward-only Drizzle migration adds the column.

Draft approval writes `component.healthUrl ?? null` when inserting or replacing
component rows. Reading an approved manifest emits `healthUrl` only when the
stored value is non-null, matching the optional manifest contract. The draft
review page displays the field so an operator can verify the exact endpoint
before approval.

## Health target selection

For each active component:

1. If `healthUrl` is present, use it as the component HTTP target.
2. Otherwise, use `url` when present.
3. If neither exists, do not create a component HTTP target.

For project domains, the default HTTP target remains
`https://<declared-domain>`. Before adding that target, DeployHub computes the
origin of every component `url` that has an explicit `healthUrl`. If a domain's
origin matches one of those component origins, the domain root target is
suppressed because the component health URL is the more specific availability
probe.

This suppression compares normalized URL origins, including the effective port.
For example, `https://api.example.com` and
`https://api.example.com:443/path` share an origin, while
`https://api.example.com:8443/path` does not. Manifest validation guarantees
valid URLs before these values reach the worker.

After origin-based suppression, exact target URLs are deduplicated with the
existing preference for a component-scoped event over a project-scoped domain
event. The health collector continues to issue `GET` requests with its existing
timeout and severity mapping.

Domain TLS targets are built independently by the SSL collector and are not
suppressed or changed.

## Data flow

1. CLI or API validation parses `healthUrl` using the canonical manifest schema.
2. A submitted draft stores the validated manifest unchanged.
3. Human review shows `healthUrl` for each component.
4. Approval writes `health_url` into the component row.
5. The health worker selects `healthUrl ?? url`, suppresses a same-origin domain
   root when the explicit URL exists, and records the resulting health event.
6. The project status query uses the newest event for the component and event
   kind, so a successful probe records `up` and replaces the previous `down
   (404)` judgement.

## Error handling and compatibility

- Invalid health URLs fail manifest validation and cannot be submitted or
  approved.
- Existing manifests and database rows have no `healthUrl`; their health targets
  remain unchanged.
- A health URL may use a different origin from the component URL. It is still
  checked, but the component URL's matching domain root is suppressed because
  the explicit probe represents that component's declared availability check.
- Network errors, timeouts, and HTTP status handling remain unchanged.
- Removing `healthUrl` in a later approved manifest restores the original
  component URL and domain-root behavior.

## Yield registration

After the updated DeployHub schema and application are deployed, the existing
Yield manifest adds the confirmed readiness URL to its `api` component:

```yaml
healthUrl: https://api.yield.ktgobiz.co.kr/health/ready
```

The existing-project workflow is then run from the Yield repository root:

1. Build the DeployHub CLI.
2. Run `status` and `diff` with `DEPLOYHUB_URL` and `DEPLOYHUB_TOKEN` supplied
   only through environment variables.
3. Validate the manifest against the deployed latest schema.
4. Submit `sync --draft`.
5. Have a person review and approve the Draft URL.

No token or provider secret is written to a file, command argument, log, design
document, or conversation.

## Testing

- Manifest schema tests accept a valid full `healthUrl` and reject relative or
  non-HTTP(S) values.
- JSON Schema tests assert the new property and its URI constraints.
- Manifest diff tests report additions, changes, and removals of `healthUrl`.
- Database migration and schema tests verify the nullable column.
- Draft action tests verify persistence and replacement behavior.
- Manifest API tests verify the approved-field round trip.
- Draft review tests verify that the field is visible to reviewers.
- Worker tests reproduce the Yield root-404 shape, prove that the explicit URL
  is checked, prove that the same-origin domain root is suppressed, and prove
  that different-origin and no-`healthUrl` behavior remains unchanged.
- Focused tests, type checking, the full DeployHub test suite, CLI build, and
  local manifest validation must pass before completion.

## Rollout

The database migration and DeployHub application must be deployed before a
remote Yield draft containing `healthUrl` can validate. Once the draft is
approved, the next five-minute health cycle should record `up` for the Yield API
and clear the false `장애` judgement, provided the readiness endpoint remains
successful.

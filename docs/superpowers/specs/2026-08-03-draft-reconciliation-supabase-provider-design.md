# Draft Reconciliation and Supabase Provider Design

## Summary

DeployHub currently applies an approved manifest without immediately reconciling it
against resources that have already been observed. A newly declared Vercel project or
Docker container therefore remains unobserved until the next provider sync. Supabase is
accepted as a manifest provider, but DeployHub has no Supabase account connection,
collector, sync handler, or resource-linking implementation.

This change makes an approved Draft immediately useful. Approval will reconcile the
new declarations against existing observations and then enqueue fresh provider syncs
without waiting for external APIs. It also adds a Supabase Personal Access Token (PAT)
connection that discovers projects through the Supabase Management API.

## Goals

- Show matching existing Vercel, Docker, and Supabase observations immediately after a
  Draft is approved.
- Refresh relevant providers asynchronously after approval without coupling approval to
  an external API.
- Add a complete Supabase provider path: encrypted account credential, collector,
  worker sync, project resource persistence, exact manifest linking, manual sync, and
  scheduled sync.
- Distinguish an account that needs connecting, a pending sync, an unmatched
  declaration, and a successful observation in the UI.
- Keep secrets out of resource metadata, errors, logs, files, and user-visible output.

## Non-goals

- Supabase OAuth. The first version uses a PAT and can be extended to OAuth later.
- Reading database contents, schemas, environment variables, API keys, service-role
  keys, or database passwords.
- Creating, changing, pausing, or deleting Supabase projects.
- Waiting for provider APIs before completing Draft approval.
- Automatically approving Drafts.

## Architecture

### Post-approval reconciliation

Draft approval remains the authority that applies a manifest. Inside the approval
transaction, DeployHub will:

1. Mark the pending Draft approved.
2. Upsert the project, components, and domains.
3. Reconcile every active resource already stored in DeployHub against the resulting
   component declarations.
4. Replace stale automatically created links with the links implied by the current
   declaration while preserving links created by a user.

After the transaction commits, DeployHub will enqueue deduplicated Vercel, Docker, and
Supabase sync jobs only for observation sources used by the applied declarations.
Vercel and Supabase jobs target their connected accounts; Docker is queued only when a
component declares a container name. Queueing is best effort: an enqueue failure is
recorded for operations visibility as a secret-free server warning but does not revert
or misreport the approved Draft. A later manual or scheduled sync provides recovery.
Revalidation then refreshes the Draft, project list, project detail, and provider
settings pages.

This design separates two concerns:

- Reconciliation is deterministic and uses only DeployHub's database, so it can update
  the page immediately.
- Provider sync obtains fresh external state asynchronously, so provider latency or an
  outage cannot block approval.

### Generic declared-resource reconciliation

The existing declared-link logic will be extended into a project-safe reconciliation
operation. Exact matching rules are:

- Vercel: component `provider` is `vercel` and `externalRef` equals the resource
  `externalId`.
- Docker: component `containerName` equals the resource `name`. The component may
  declare `hostinger`, `docker`, or another deployment provider because Docker is the
  observation source for the actual container.
- Supabase: component `provider` is `supabase` and `externalRef` equals the project ref
  stored as the resource `externalId`. A Supabase project may legitimately serve more
  than one declared component, such as database, authentication, and storage, so the
  same resource is linked to every distinct component with that exact project ref.

Vercel and Docker create an automatic link only when the match is unambiguous. An absent
or ambiguous match creates no automatic link. Supabase uses the exact-match multi-link
rule above. Existing `user` links are never removed or replaced. Existing `manifest` or
`label` links that no longer match the applied manifest are removed so the observation
does not remain attached to a stale declaration.

The provider sync handlers continue to call the same reconciliation boundary after
upserting their resources. Approval and later syncs therefore use identical matching
rules.

## Supabase Provider

### Authentication and account storage

The Providers settings page will accept a Supabase PAT. DeployHub will test the token
with the Supabase Management API before storing it. The PAT will be encrypted with the
existing provider-token encryption mechanism and will never be shown again; the UI may
show only the existing safe token suffix.

The first version supports one Supabase connection per DeployHub installation. It uses
the stable provider-account name `supabase`; the connected PAT may discover every
project visible to that Supabase user. Saving a new PAT replaces that connection after
the new token passes verification. Multiple independently scoped Supabase accounts are
deferred until the UI and resource ownership rules can identify them explicitly.

The PAT has the privileges of its Supabase user. The UI will tell administrators to use
the least-privileged account suitable for project discovery and to treat the PAT as a
secret. The collector uses HTTPS with an `Authorization: Bearer` header as documented by
the Supabase Management API:
https://supabase.com/docs/reference/api/introduction

### Collection

The collector will call `GET https://api.supabase.com/v1/projects` and validate the
documented project-list response. Each project is normalized as:

- `provider`: `supabase`
- `resourceType`: `supabase_project`
- `externalId`: project `ref`
- `name`: project name
- `status`: normalized project status
- `region`: project region when present
- `url`: omitted unless the Management API returns a confirmed public project URL
- `metadata`: non-secret organization identifiers and non-secret database engine/version
  facts that are present in the project response
- `observedAt`: collection time

Malformed required fields fail the sync with a generic safe error. Authentication,
permission, rate-limit, transport, and response-format failures must not include the PAT
or raw response body.

### Sync lifecycle

Saving a valid Supabase account enqueues its first sync. The Providers page exposes a
manual sync action. The worker enqueues Supabase sync jobs at startup and every six
hours, matching the low-frequency account-wide provider pattern used by Vercel and
GitHub.

The sync handler decrypts the account PAT, collects all visible projects, upserts active
resources, marks projects no longer returned as deleted for that provider account,
reconciles the observed project refs with manifest declarations, and updates
`lastSyncAt` or `lastError`. Sync errors leave the last successful observations intact.

## User Interface

### Provider settings

The Providers page gains a Supabase section with:

- a password input for the PAT;
- a connection-and-save action;
- an explicit note that PATs carry the Supabase user's privileges;
- account cards showing a safe token suffix, last verification, last sync, and last
  error;
- a manual sync button.

### Project observation states

Project composition will use distinct meanings instead of treating every missing
observation as the same condition:

- `연결 필요`: the component declares a provider that has no connected provider
  account and cannot be observed through another configured collector;
- `동기화 대기`: the provider account exists and a relevant provider job is currently
  `pending` or `running`;
- `관측되지 않음`: the provider account has completed at least one sync since the
  component declaration was last changed, no relevant job is active, and no exact
  resource match exists;
- observed resource: provider project or container name, status, and safe metadata such
  as region.

If an account exists but has never completed a sync and no job is active because queueing
failed, the UI shows the provider's safe `lastError` when present and otherwise shows
`동기화 필요` with a manual sync action. These states are derived from provider account
sync timestamps, active jobs, component update time, and exact resource links; they are
not stored as a second source of truth.

The existing provider summary continues to prefer actual observations over declarations.
A connected Supabase project contributes `Supabase` to that summary. A Hostinger-hosted
worker observed through Docker contributes the existing VPS representation.

## Error Handling and Security

- Draft approval never calls an external Provider API.
- Failure to enqueue a refresh job does not roll back an approved Draft.
- Provider sync failures are stored as safe generic `lastError` values and retried by a
  later manual or scheduled sync.
- Provider tokens are accepted only in password fields, encrypted before persistence,
  and never stored in resources, deployments, snapshots, events, or jobs.
- Collector errors never include request authorization headers or raw provider response
  bodies.
- Supabase collection is read-only.
- Automatic link conflicts create no link and preserve any user link.

## Testing

### Collector tests

- Sends the PAT only in the Authorization header.
- Tests a valid connection and rejects unauthorized or malformed responses safely.
- Normalizes project ref, name, status, region, organization, and database facts.
- Handles an empty list, a large list, and malformed list entries deterministically.
- Redacts PATs and response bodies from errors and normalized metadata.

### Provider action and page tests

- Rejects an empty PAT and does not write an account.
- Tests the connection before encrypting and upserting an account.
- Enqueues an immediate Supabase sync after a successful save.
- Supports manual Supabase sync for an authenticated administrator.
- Renders Supabase connection, account, status, and security guidance UI.

### Worker tests

- Upserts discovered projects and marks absent projects deleted per account.
- Sets `lastSyncAt` and clears `lastError` after success.
- Stores a safe `lastError` and preserves the last observations after failure.
- Links an exact Supabase project ref to every matching declared component and refuses
  mismatched declarations.
- Enqueues Supabase jobs on startup and the six-hour provider schedule.

### Draft approval and reconciliation tests

- Immediately links existing Vercel, Docker, and Supabase resources after approval.
- Removes stale manifest or label links after declaration changes.
- Preserves user-created links.
- Does not create Vercel or Docker links for ambiguous matches and supports the explicit
  Supabase exact-ref multi-link rule.
- Enqueues deduplicated Vercel, Docker, and Supabase refresh jobs after commit.
- Keeps the Draft approved if refresh enqueueing fails.

### UI state tests

- Distinguishes `연결 필요`, `동기화 대기`, and `관측되지 않음`.
- Shows Supabase project status and region after a successful observation.
- Keeps existing Vercel and Docker summary behavior intact.

## Rollout and Verification

1. Run focused collector, worker, database query, Draft action, and provider page tests.
2. Run the full repository test, typecheck, and production build gates.
3. Deploy the database-compatible application and worker changes together; no schema
   migration is expected because existing provider account, resource, job, and link
   tables already support the required data.
4. Connect a Supabase PAT through the production Providers page.
5. Confirm the first sync discovers the LinkVault project ref without exposing secrets.
6. Approve or resubmit a LinkVault Draft and confirm the existing Vercel, Docker, and
   Supabase observations appear without waiting for scheduled syncs.
7. Verify a later scheduled sync updates timestamps and leaves the links stable.

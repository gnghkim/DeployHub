import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDraft } from '@deployhub/db';
import {
  parseManifest,
  type ManifestDiff,
  type ValidationIssue,
} from '@deployhub/manifest';
import { approveDraft, rejectDraft } from '../../../../actions/drafts';
import { Topbar } from '../../../../components/shell/topbar';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { db } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

type FieldSource = {
  origin?: string;
  evidence?: string;
  source?: string;
};

const emptyDiff: ManifestDiff = {
  project: [],
  componentsAdded: [],
  componentsChanged: [],
  componentsRemoved: [],
  domainsAdded: [],
  domainsRemoved: [],
};

const MONO_PROJECT_FIELDS = new Set([
  'slug',
  'lifecycle',
  'importance',
  'repository',
]);

function storedDiff(value: unknown): ManifestDiff {
  return typeof value === 'object' && value !== null
    ? value as ManifestDiff
    : emptyDiff;
}

function validationIssues(value: unknown): ValidationIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  return ['errors', 'warnings'].flatMap((key) => (
    Array.isArray(record[key])
      ? record[key] as ValidationIssue[]
      : []
  ));
}

function fieldSources(value: unknown): {
  component: string;
  field: string;
  value: FieldSource;
}[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([component, fields]) => {
      if (typeof fields !== 'object' || fields === null) return [];
      return Object.entries(fields as Record<string, unknown>).flatMap(
        ([field, source]) => (
          typeof source === 'object' && source !== null
            ? [{
              component,
              field,
              value: source as FieldSource,
            }]
            : []
        ),
      );
    },
  );
}

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraft(db, id);
  if (!draft) notFound();

  const parsed = parseManifest(draft.manifestYaml);
  const title = parsed.ok ? parsed.manifest.metadata.name : 'Validation failed';
  const components = parsed.ok ? parsed.manifest.spec.components : [];
  const diff = storedDiff(draft.diff);
  const issues = validationIssues(draft.validationResult);
  const sources = fieldSources(draft.fieldSources);
  const approve = approveDraft.bind(null, draft.id);
  const reject = rejectDraft.bind(null, draft.id);

  return (
    <>
      <Topbar title={`Draft · ${title}`} />
      <main className="space-y-6 p-4 md:p-8">
        <div>
          <Link
            href="/settings/drafts"
            className="text-sm text-[var(--annotation)] hover:text-[var(--line)]"
          >
            ← Draft 목록
          </Link>
          <div className="mt-4 flex items-center gap-3">
            <h2 className="text-xl font-medium text-[var(--line)]">
              {title}
            </h2>
            <Badge
              tone={draft.status === 'pending_review' ? 'warning' : 'neutral'}
            >
              {draft.status}
            </Badge>
          </div>
        </div>

        <Card>
          <h3 className="text-base font-medium text-[var(--line)]">
            변경 요약
          </h3>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <section>
              <h4 className="text-sm font-medium text-[var(--annotation)]">
                프로젝트 필드
              </h4>
              <ul className="mt-2 space-y-1 text-sm">
                {diff.project.map((change) => (
                  <li
                    key={change.field}
                    className={
                      MONO_PROJECT_FIELDS.has(change.field)
                        ? 'font-mono'
                        : undefined
                    }
                  >
                    {change.field}: {change.from ?? '—'} → {change.to ?? '—'}
                  </li>
                ))}
                {diff.project.length === 0 ? <li>변경 없음</li> : null}
              </ul>
            </section>
            <section>
              <h4 className="text-sm font-medium text-[var(--annotation)]">
                구성요소
              </h4>
              <ul className="mt-2 space-y-1 text-sm">
                {diff.componentsAdded.map((name) => (
                  <li key={`added-${name}`} className="text-[var(--confirm)]">
                    추가: {name}
                  </li>
                ))}
                {diff.componentsChanged.map((change) => (
                  <li key={`${change.name}-${change.field}`}>
                    변경: {change.name}.{change.field} ({change.from ?? '—'} →{' '}
                    {change.to ?? '—'})
                  </li>
                ))}
                {diff.componentsRemoved.map((name) => (
                  <li key={`removed-${name}`} className="text-[var(--caution)]">
                    {name}: manifest에 없음 — 자동 삭제하지 않음
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="text-sm font-medium text-[var(--annotation)]">
                도메인
              </h4>
              <ul className="mt-2 space-y-1 text-sm">
                {diff.domainsAdded.map((domain) => (
                  <li key={`domain-add-${domain}`}>추가: {domain}</li>
                ))}
                {diff.domainsRemoved.map((domain) => (
                  <li key={`domain-remove-${domain}`}>삭제: {domain}</li>
                ))}
              </ul>
            </section>
          </div>
        </Card>

        <Card>
          <h3 className="text-base font-medium text-[var(--line)]">
            배포 선언
          </h3>
          <div className="mt-3 space-y-4 text-sm">
            {components.map((component) => {
              const declarations = [
                ['provider', component.provider],
                ['externalRef', component.externalRef],
                ['container', component.container],
                ['url', component.url],
              ] as const;
              return (
                <section key={component.name}>
                  <h4 className="font-mono font-medium text-[var(--line-mute)]">
                    {component.name}
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {declarations.map(([field, value]) => {
                      const source = sources.find(
                        (entry) => entry.component === component.name
                          && entry.field === field,
                      );
                      return (
                        <li
                          key={field}
                          className={
                            source?.value.origin === 'inferred'
                              ? 'font-mono text-[var(--caution)]'
                              : 'font-mono text-[var(--line-mute)]'
                          }
                        >
                          {field}: {value ?? '—'}
                          {source?.value.origin
                            ? ` · ${source.value.origin}`
                            : ''}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {components.length === 0 ? <p>표시할 선언이 없습니다.</p> : null}
          </div>
        </Card>

        <Card>
          <h3 className="text-base font-medium text-[var(--line)]">
            검증 결과
          </h3>
          {issues.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {issues.map((issue, index) => (
                <li
                  key={`${issue.path}-${index}`}
                  className={
                    issue.severity === 'error'
                      ? 'text-[var(--fault)]'
                      : 'text-[var(--caution)]'
                  }
                >
                  {issue.path || 'manifest'}: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--confirm)]">
              오류나 경고가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <h3 className="text-base font-medium text-[var(--line)]">
            필드 출처
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {sources.map(({ component, field, value }) => {
              const uncertain = value.origin === 'inferred'
                || value.origin === 'unknown';
              return (
                <li
                  key={`${component}-${field}`}
                  className={
                    uncertain
                      ? 'text-[var(--caution)]'
                      : 'text-[var(--line-mute)]'
                  }
                >
                  {component}.{field}: {value.origin ?? 'unknown'}
                  {value.evidence ? ` · ${value.evidence}` : ''}
                </li>
              );
            })}
            {sources.length === 0 ? <li>제출된 필드 출처가 없습니다.</li> : null}
          </ul>
        </Card>

        {draft.status === 'pending_review' ? (
          <div className="flex gap-3">
            <form action={approve}>
              <Button type="submit" variant="primary">승인</Button>
            </form>
            <form action={reject}>
              <Button type="submit" variant="tertiary">거부</Button>
            </form>
          </div>
        ) : null}
      </main>
    </>
  );
}

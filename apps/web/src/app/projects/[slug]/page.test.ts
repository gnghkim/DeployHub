import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('project detail status', () => {
  it('adds the derived status to the top metadata line', () => {
    expect(page).toContain('listProjectStatusData(db, [project.id])');
    expect(page).toContain('<Badge tone={STATUS_TONES[status.status]}>');
    expect(page).toContain('{status.status}');
  });

  it('shows latest warning and critical evidence below the composition', () => {
    const composition = page.indexOf('<ArchitectureComposition');
    const evidence = page.indexOf('판정 근거');
    const deployments = page.indexOf('최종 배포');

    expect(page).toContain("event.severity === 'warning'");
    expect(page).toContain("event.severity === 'critical'");
    expect(page).toContain('{event.currentValue}');
    expect(page).toContain('{event.detail}');
    expect(composition).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(deployments);
  });

  it('keeps evidence separate from composition observations and adds no timeline', () => {
    expect(page).not.toContain('href="/events"');
    expect(page).not.toContain('/events?');
    expect(page).toContain('space-y-6 p-4 md:p-8');
  });
});

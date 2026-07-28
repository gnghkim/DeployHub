import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import * as dbApi from '../index';
import { schema, type Db } from '../index';
import { judgeStatus, listProjectStatusData } from './status';

const event = (severity: 'info' | 'warning' | 'critical') => ({
  kind: 'health_status' as const,
  severity,
});

describe('project status API', () => {
  it('exports the project status judge', () => {
    expect(dbApi).toHaveProperty('judgeStatus');
  });

  it('exports the batched project status query', () => {
    expect(dbApi).toHaveProperty('listProjectStatusData');
  });

  it('이벤트도 관측도 없으면 미확인이다', () => {
    expect(judgeStatus({ latestEvents: [], hasObservation: false }))
      .toBe('미확인');
  });

  it('이벤트가 없어도 관측이 있으면 정상이다', () => {
    expect(judgeStatus({ latestEvents: [], hasObservation: true }))
      .toBe('정상');
  });

  it('최신 critical 이벤트가 하나라도 있으면 장애다', () => {
    expect(judgeStatus({
      latestEvents: [event('critical')],
      hasObservation: true,
    })).toBe('장애');
  });

  it('같은 대상에서 critical 뒤 info가 오면 최신 이벤트만 받아 정상이다', () => {
    expect(judgeStatus({
      latestEvents: [event('info')],
      hasObservation: true,
    })).toBe('정상');
  });

  it('다른 대상의 critical은 한 대상의 info로 해소되지 않아 장애다', () => {
    expect(judgeStatus({
      latestEvents: [event('info'), event('critical')],
      hasObservation: true,
    })).toBe('장애');
  });

  it('warning과 critical이 함께 살아 있으면 최악 심각도인 장애다', () => {
    expect(judgeStatus({
      latestEvents: [event('warning'), event('critical')],
      hasObservation: true,
    })).toBe('장애');
  });
});

describe('listProjectStatusData', () => {
  let db: Db;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const started = await startTestDb();
    db = started.db;
    stop = started.stop;
  }, 120_000);

  afterAll(async () => { await stop(); });

  beforeEach(async () => {
    await db.delete(schema.changeEvents);
    await db.delete(schema.resources);
    await db.delete(schema.projects);
  });

  async function seedProject(slug: string) {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: slug, slug })
      .returning();
    if (!project) throw new Error('project insert failed');
    return project;
  }

  async function seedComponent(projectId: string, slug: string) {
    const [component] = await db
      .insert(schema.components)
      .values({
        projectId,
        name: slug,
        slug,
        componentType: 'backend',
      })
      .returning();
    if (!component) throw new Error('component insert failed');
    return component;
  }

  async function seedResource(name: string, deletedAt: Date | null = null) {
    const [resource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker',
        externalId: name,
        resourceType: 'docker_container',
        name,
        deletedAt,
      })
      .returning();
    if (!resource) throw new Error('resource insert failed');
    return resource;
  }

  it('이벤트 없는 프로젝트도 결과에 남기고 관측이 없으면 미확인이다', async () => {
    const project = await seedProject('event-free');

    const result = await listProjectStatusData(db, [project.id]);

    expect(result.get(project.id)).toEqual({
      status: '미확인',
      hasObservation: false,
      latestEvents: [],
    });
  });

  it('같은 대상의 최신 이벤트를 occurred_at이 아닌 seq로 골라 critical 뒤 info면 정상이다', async () => {
    const project = await seedProject('latest-by-seq');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        kind: 'health_status',
        severity: 'critical',
        currentValue: 'down',
        detail: 'was down',
        occurredAt: new Date('2026-07-28T02:00:00.000Z'),
      },
      {
        projectId: project.id,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
        detail: 'recovered',
        occurredAt: new Date('2026-07-28T01:00:00.000Z'),
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('정상');
    expect(status?.latestEvents).toHaveLength(1);
    expect(status?.latestEvents[0]).toMatchObject({
      kind: 'health_status',
      severity: 'info',
      currentValue: 'up',
      detail: 'recovered',
    });
  });

  it('자원을 다른 구성요소로 재연결한 뒤 running이면 그 자원의 최신 상태만 남아 정상이다', async () => {
    const project = await seedProject('relinked-running');
    const first = await seedComponent(project.id, 'api');
    const second = await seedComponent(project.id, 'worker');
    const resource = await seedResource('relinked-running');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        componentId: first.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'exited',
        detail: 'api container exited',
      },
      {
        projectId: project.id,
        componentId: second.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'info',
        currentValue: 'running',
        detail: 'worker container running',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('정상');
    expect(status?.latestEvents).toHaveLength(1);
    expect(status?.latestEvents[0]).toMatchObject({
      componentId: second.id,
      resourceId: resource.id,
      kind: 'container_status',
      severity: 'info',
      currentValue: 'running',
    });
  });

  it('자원을 다른 구성요소로 재연결한 뒤 exited이면 그 자원의 최신 상태로 장애다', async () => {
    const project = await seedProject('relinked-exited');
    const first = await seedComponent(project.id, 'api');
    const second = await seedComponent(project.id, 'worker');
    const resource = await seedResource('relinked-exited');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        componentId: first.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'info',
        currentValue: 'running',
        detail: 'api container running',
      },
      {
        projectId: project.id,
        componentId: second.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'exited',
        detail: 'worker container exited',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('장애');
    expect(status?.latestEvents).toHaveLength(1);
    expect(status?.latestEvents[0]).toMatchObject({
      componentId: second.id,
      resourceId: resource.id,
      kind: 'container_status',
      severity: 'critical',
      currentValue: 'exited',
    });
  });

  it('같은 자원의 container_status와 container_health는 각각 최신 이벤트를 남긴다', async () => {
    const project = await seedProject('resource-event-kinds');
    const component = await seedComponent(project.id, 'api');
    const resource = await seedResource('resource-event-kinds');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        componentId: component.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'exited',
        detail: 'container exited',
      },
      {
        projectId: project.id,
        componentId: component.id,
        resourceId: resource.id,
        kind: 'container_health',
        severity: 'info',
        currentValue: 'healthy',
        detail: 'container healthy',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('장애');
    expect(status?.latestEvents).toHaveLength(2);
    expect(status?.latestEvents.map((latest) => latest.kind).sort()).toEqual([
      'container_health',
      'container_status',
    ]);
  });

  it('구성요소 범위와 프로젝트 범위 이벤트는 같은 kind여도 서로 섞지 않는다', async () => {
    const project = await seedProject('separate-scopes');
    const component = await seedComponent(project.id, 'api');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        kind: 'health_status',
        severity: 'critical',
        currentValue: 'down',
        detail: 'project health down',
      },
      {
        projectId: project.id,
        componentId: component.id,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
        detail: 'component health up',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('장애');
    expect(status?.latestEvents).toHaveLength(2);
  });

  it('서로 다른 대상의 최신 info와 critical을 모두 남겨 장애로 판정한다', async () => {
    const project = await seedProject('different-targets');
    const first = await seedComponent(project.id, 'api');
    const second = await seedComponent(project.id, 'worker');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        componentId: first.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'exited',
        detail: 'api exited',
      },
      {
        projectId: project.id,
        componentId: second.id,
        kind: 'container_status',
        severity: 'info',
        currentValue: 'running',
        detail: 'worker running',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.status).toBe('장애');
    expect(status?.latestEvents).toHaveLength(2);
  });

  it('여러 대상의 최신 이벤트를 seq 내림차순으로 돌려준다', async () => {
    const project = await seedProject('evidence-order');
    const inserted = await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'healthy',
        detail: 'older health evidence',
      },
      {
        projectId: project.id,
        kind: 'sync_failure',
        severity: 'warning',
        currentValue: 'failed',
        detail: 'newer sync evidence',
      },
    ]).returning();
    const older = inserted[0];
    const newer = inserted[1];
    if (!older || !newer) throw new Error('event insert failed');

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status?.latestEvents.map((event) => event.seq)).toEqual([
      newer.seq,
      older.seq,
    ]);
  });

  it('suggested 연결은 관측이 아니고 확정된 활성 자원 연결만 관측이다', async () => {
    const suggestedProject = await seedProject('suggested-only');
    const suggestedComponent = await seedComponent(suggestedProject.id, 'api');
    const suggestedResource = await seedResource('suggested');
    await db.insert(schema.componentResources).values({
      componentId: suggestedComponent.id,
      resourceId: suggestedResource.id,
      relationType: 'runs_on',
      linkedBy: 'suggested',
    });

    const observedProject = await seedProject('observed');
    const observedComponent = await seedComponent(observedProject.id, 'api');
    const observedResource = await seedResource('observed');
    await db.insert(schema.componentResources).values({
      componentId: observedComponent.id,
      resourceId: observedResource.id,
      relationType: 'runs_on',
      linkedBy: 'user',
    });

    const statuses = await listProjectStatusData(db, [
      suggestedProject.id,
      observedProject.id,
    ]);

    expect(statuses.get(suggestedProject.id)).toMatchObject({
      hasObservation: false,
      status: '미확인',
    });
    expect(statuses.get(observedProject.id)).toMatchObject({
      hasObservation: true,
      status: '정상',
    });
  });

  it('삭제된 자원 대상 이벤트는 제외하되 resource_id가 null인 이벤트는 유지한다', async () => {
    const project = await seedProject('deleted-resource');
    const component = await seedComponent(project.id, 'api');
    const resource = await seedResource('deleted', new Date());
    await db.insert(schema.componentResources).values({
      componentId: component.id,
      resourceId: resource.id,
      relationType: 'runs_on',
      linkedBy: 'user',
    });
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        componentId: component.id,
        resourceId: resource.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'exited',
        detail: 'deleted container exited',
      },
      {
        projectId: project.id,
        componentId: component.id,
        resourceId: null,
        kind: 'sync_failure',
        severity: 'warning',
        currentValue: 'failed',
        detail: 'sync failed',
      },
    ]);

    const status = (await listProjectStatusData(db, [project.id])).get(project.id);

    expect(status).toMatchObject({
      status: '주의',
      hasObservation: false,
    });
    expect(status?.latestEvents).toHaveLength(1);
    expect(status?.latestEvents[0]).toMatchObject({
      resourceId: null,
      kind: 'sync_failure',
      severity: 'warning',
    });
  });
});

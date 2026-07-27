import { describe, expect, it } from 'vitest';
import {
  resolveDeclaredLink,
  type DeclaredComponent,
  type ObservedResource,
} from './declared-link';

const web: DeclaredComponent = {
  id: 'component-web',
  projectId: 'project-deployhub',
  projectSlug: 'deployhub',
  name: 'web',
  slug: 'web',
  provider: 'hostinger',
  externalRef: null,
  containerName: 'deployhub-web',
};

const oldWeb: DeclaredComponent = {
  ...web,
  id: 'component-web-old',
  name: 'web-old',
  slug: 'web-old',
  containerName: null,
};

function dockerResource(
  name: string,
  labels: Record<string, string> = {},
): ObservedResource {
  return {
    id: `resource-${name}`,
    provider: 'docker',
    resourceType: 'docker_container',
    externalId: `container-${name}`,
    name,
    metadata: { labels },
  };
}

describe('resolveDeclaredLink', () => {
  it('container 이름이 정확히 일치할 때 manifest 연결을 고른다', () => {
    expect(resolveDeclaredLink(
      dockerResource('deployhub-web'),
      [web],
      [],
    )).toEqual({
      kind: 'link',
      componentId: web.id,
      linkedBy: 'manifest',
      environment: 'production',
    });
  });

  it('deployhub-web 선언을 deployhub-web-old 관측에 부분 일치시키지 않는다', () => {
    expect(resolveDeclaredLink(
      dockerResource('deployhub-web-old'),
      [web],
      [],
    )).toEqual({ kind: 'none', reason: 'no_match' });
  });

  it('선언된 컨테이너가 관측 자원에 없으면 연결을 만들지 않는다', () => {
    expect(resolveDeclaredLink(
      dockerResource('another-container'),
      [web],
      [],
    )).toEqual({ kind: 'none', reason: 'no_match' });
  });

  it('기존 user 연결이 있으면 정확한 자동 연결도 만들지 않는다', () => {
    expect(resolveDeclaredLink(
      dockerResource('deployhub-web'),
      [web, oldWeb],
      [{ componentId: oldWeb.id, linkedBy: 'user' }],
    )).toEqual({ kind: 'none', reason: 'user_link' });
  });

  it('manifest와 Docker 라벨이 다른 구성요소를 가리키면 충돌로 남긴다', () => {
    expect(resolveDeclaredLink(
      dockerResource('deployhub-web', {
        'deployhub.project': 'deployhub',
        'deployhub.component': 'web-old',
        'deployhub.environment': 'production',
      }),
      [web, oldWeb],
      [],
    )).toEqual({
      kind: 'conflict',
      containerName: 'deployhub-web',
      manifestComponentId: web.id,
      manifestComponentName: 'web',
      labelComponentId: oldWeb.id,
      labelComponentName: 'web-old',
    });
  });
});

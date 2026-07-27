import { z } from 'zod';
import { manifestSchema } from './schema';

const TEMPLATE = `# yaml-language-server: $schema=https://hub.nolzza.net/schemas/deployhub-v1.json
# DeployHub project manifest
apiVersion: deployhub.io/v1
kind: Project

metadata:
  name: My Project
  slug: my-project
  description: A short project description

spec:
  lifecycle: development
  importance: 3
  owner: github-user

  repository:
    provider: github
    slug: github-user/my-project

  components:
    - name: web
      type: frontend
      framework: nextjs
      runtime: nodejs
      language: typescript
      criticality: 3
      path: apps/web

  domains:
    - domain: example.com
      environment: production

  documents:
    - type: readme
      path: README.md
`;

export function manifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(manifestSchema, {
    unrepresentable: 'any',
    override: ({ jsonSchema, path }) => {
      if (
        path.join('.') ===
        'properties.spec.properties.components.items.properties.externalRef'
      ) {
        jsonSchema.type = 'string';
      }
    },
  });
}

export function manifestTemplate(): string {
  return TEMPLATE;
}

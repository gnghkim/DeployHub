import { z } from 'zod';

export const MANIFEST_VERSION = 'deployhub.io/v1' as const;

export const COMPONENT_TYPES = [
  'frontend',
  'backend',
  'api',
  'worker',
  'scheduler',
  'database',
  'authentication',
  'storage',
  'cache',
  'queue',
  'monitoring',
] as const;

const projectLifecycles = [
  'experimental',
  'development',
  'production',
  'deprecated',
] as const;

const trimmedEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().trim().pipe(z.enum(values));
const trimmedLiteral = <T extends string>(value: T) =>
  z.string().trim().pipe(z.literal(value));
const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nonEmptyString = z.string().trim().min(1);
const oneToFive = z.number().int().min(1).max(5);

const metadataSchema = z
  .object({
    name: nonEmptyString,
    slug: slugSchema,
    description: z.string().trim().optional(),
  })
  .strict();

const repositorySchema = z
  .object({
    provider: trimmedLiteral('github'),
    slug: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  })
  .strict();

const componentSchema = z
  .object({
    name: slugSchema,
    type: trimmedEnum(COMPONENT_TYPES),
    framework: nonEmptyString.optional(),
    runtime: nonEmptyString.optional(),
    language: nonEmptyString.optional(),
    criticality: oneToFive.optional(),
    path: nonEmptyString.optional(),
  })
  .strict();

const domainSchema = z
  .object({
    domain: nonEmptyString,
    environment: nonEmptyString,
  })
  .strict();

const documentSchema = z
  .object({
    type: nonEmptyString,
    path: nonEmptyString,
  })
  .strict();

const specSchema = z
  .object({
    lifecycle: trimmedEnum(projectLifecycles),
    importance: oneToFive.optional(),
    owner: nonEmptyString.optional(),
    repository: repositorySchema.optional(),
    components: z
      .array(componentSchema)
      .min(1)
      .refine(
        (components) =>
          new Set(components.map((component) => component.name)).size ===
          components.length,
        { message: 'Component names must be unique' },
      ),
    domains: z.array(domainSchema).optional(),
    documents: z.array(documentSchema).optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    apiVersion: trimmedEnum([MANIFEST_VERSION]),
    kind: trimmedLiteral('Project'),
    metadata: metadataSchema,
    spec: specSchema,
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;

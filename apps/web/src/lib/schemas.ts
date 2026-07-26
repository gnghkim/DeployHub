import { z } from 'zod';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const projectInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG, 'slug는 소문자·숫자·하이픈만 사용합니다.'),
  description: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  status: z.enum(['active', 'paused', 'maintenance', 'archived']),
  lifecycle: z.enum(['experimental', 'development', 'production', 'deprecated']),
  importance: z.coerce.number().int().min(1).max(5),
  owner: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  repository: z.preprocess(
    emptyToUndefined,
    z.string().regex(REPO, 'owner/name 형식이어야 합니다.').optional(),
  ),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

export const COMPONENT_TYPES = [
  'frontend', 'backend', 'api', 'worker', 'scheduler', 'database',
  'authentication', 'storage', 'cache', 'queue', 'monitoring',
] as const;

export const componentInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG, 'slug는 소문자·숫자·하이픈만 사용합니다.'),
  componentType: z.enum(COMPONENT_TYPES),
  framework: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  runtime: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  language: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  criticality: z.coerce.number().int().min(1).max(5),
});

export type ComponentInput = z.infer<typeof componentInputSchema>;

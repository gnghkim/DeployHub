import { describe, expect, it } from 'vitest';
import { COMPONENT_TYPES, MANIFEST_VERSION } from './schema';
import { manifestJsonSchema } from './json-schema';

type JsonSchema = {
  $schema?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  type?: string;
};

const property = (schema: JsonSchema, name: string): JsonSchema => {
  const value = schema.properties?.[name];
  if (!value) {
    throw new Error(`Missing JSON Schema property: ${name}`);
  }
  return value;
};

describe('manifestJsonSchema', () => {
  it('uses JSON Schema draft 2020-12', () => {
    expect(manifestJsonSchema().$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
  });

  it('exposes deployhub.io/v1 as the apiVersion enum', () => {
    const schema = manifestJsonSchema() as JsonSchema;
    expect(property(schema, 'apiVersion').enum).toContain(MANIFEST_VERSION);
  });

  it('exposes all 11 component types in DB enum order', () => {
    const schema = manifestJsonSchema() as JsonSchema;
    const componentType = property(
      property(property(schema, 'spec'), 'components').items!,
      'type',
    );

    expect(componentType.enum).toEqual(COMPONENT_TYPES);
  });

  it('exposes deployment provider and externalRef input validation', () => {
    const schema = manifestJsonSchema() as JsonSchema;
    const component = property(
      property(property(schema, 'spec'), 'components').items!,
      'provider',
    );
    const externalRef = property(
      property(property(schema, 'spec'), 'components').items!,
      'externalRef',
    );

    expect(component.enum).toContain('self-hosted');
    expect(component.enum).not.toContain('other');
    expect(externalRef.type).toBe('string');
  });

  it('returns the same schema on repeated calls', () => {
    expect(manifestJsonSchema()).toEqual(manifestJsonSchema());
  });
});

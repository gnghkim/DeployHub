import {
  MANIFEST_VERSION,
  manifestJsonSchema,
} from '@deployhub/manifest';

export function GET(): Response {
  return Response.json(manifestJsonSchema(), {
    headers: {
      'X-Manifest-Version': MANIFEST_VERSION,
    },
  });
}

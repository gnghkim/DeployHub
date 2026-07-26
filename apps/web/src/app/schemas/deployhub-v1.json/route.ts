import {
  MANIFEST_VERSION,
  manifestJsonSchema,
} from '@deployhub/manifest';

export function GET(): Response {
  return Response.json(manifestJsonSchema(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      ETag: 'W/"deployhub.io-v1"',
      'X-Manifest-Version': MANIFEST_VERSION,
    },
  });
}

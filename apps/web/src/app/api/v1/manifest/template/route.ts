import {
  MANIFEST_VERSION,
  manifestTemplate,
} from '@deployhub/manifest';

export function GET(): Response {
  return new Response(manifestTemplate(), {
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'X-Manifest-Version': MANIFEST_VERSION,
    },
  });
}

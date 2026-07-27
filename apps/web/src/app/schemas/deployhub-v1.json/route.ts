import { manifestSchemaResponse } from '../../../lib/manifest-schema-response';

export function GET(request?: Request): Response {
  return manifestSchemaResponse(request);
}

export function HEAD(request?: Request): Response {
  return manifestSchemaResponse(request, false);
}

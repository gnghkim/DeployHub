export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  if (!authorization) return undefined;

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

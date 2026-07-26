export function isAllowedLogin(
  login: string,
  rawAllowlist: string | undefined,
): boolean {
  if (login.trim() === '') return false;
  if (rawAllowlist === undefined) return false;

  const allowed = rawAllowlist
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  if (allowed.length === 0) return false;
  return allowed.includes(login.trim().toLowerCase());
}

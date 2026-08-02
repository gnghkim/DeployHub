export function isSuccessfulProductionDeployment(input: {
  provider: 'docker' | 'vercel';
  environment: string;
  status: string;
}): boolean {
  if (input.environment.toLowerCase() !== 'production') return false;
  const status = input.status.toUpperCase();
  return input.provider === 'docker' ? status === 'RUNNING' : status === 'READY';
}

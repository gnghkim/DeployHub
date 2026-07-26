import { auth } from '@/auth/config';

export default async function Home() {
  const session = await auth();
  return (
    <main>
      <h1>DeployHub</h1>
      <p>{session?.user?.name ?? '미인증'}</p>
    </main>
  );
}

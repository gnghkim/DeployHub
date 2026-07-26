import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@deployhub/db';
import { isAllowedLogin } from './allowlist';

const { db } = createDb(process.env.DATABASE_URL ?? '');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ profile }) {
      const login = typeof profile?.login === 'string' ? profile.login : '';
      if (!isAllowedLogin(login, process.env.ALLOWED_GITHUB_LOGINS)) {
        console.warn(`[auth] 허용되지 않은 로그인 거부: ${login || '(빈 값)'}`);
        return false;
      }

      const githubId = BigInt(profile?.id ?? '');
      await db
        .insert(schema.users)
        .values({
          githubId,
          githubLogin: login,
          name: typeof profile?.name === 'string' ? profile.name : null,
          email: typeof profile?.email === 'string' ? profile.email : null,
          avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : null,
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.users.githubId,
          set: { githubLogin: login, lastLoginAt: new Date() },
        });
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.login) {
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.githubLogin, profile.login as string));
        if (user) token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === 'string') session.user.id = token.userId;
      return session;
    },
  },
});

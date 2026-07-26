import type { NextAuthConfig } from 'next-auth';

/**
 * Edge 런타임에서 안전한 최소 Auth.js 설정.
 *
 * 미들웨어는 Edge 에서 실행되므로 `pg` 같은 Node 전용 모듈을 끌어들이면
 * `node:util/types` 를 찾지 못해 500 이 난다. 따라서 DB 를 건드리는
 * 콜백(signIn/jwt/session)과 `@deployhub/db` import 는 여기 두지 않는다.
 *
 * 보안 성질은 약해지지 않는다. 화이트리스트 검사는 세션 토큰을 발급하는
 * `signIn` 콜백(config.ts)에 그대로 있고, 허용되지 않은 로그인에는 애초에
 * 토큰이 발급되지 않는다. 미들웨어는 이미 발급된 JWT 의 유효성만 본다.
 */
export const edgeAuthConfig: NextAuthConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
};

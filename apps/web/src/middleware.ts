import NextAuth from 'next-auth';
import { edgeAuthConfig } from '@/auth/edge-config';

// Edge 안전 설정만 사용한다. `@/auth/config` 를 import 하면 `pg` 가 딸려와
// Edge 런타임에서 `node:util/types` 를 찾지 못하고 전체 요청이 500 이 된다.
//
// `export const { auth: middleware } = NextAuth(...)` 형태는 Next 의 정적
// 분석이 함수로 인식하지 못하므로 default export 로 내보낸다.
const { auth } = NextAuth(edgeAuthConfig);

export default auth;

export const config = {
  matcher: [
    '/((?!api/auth(?:/|$)|api/v1/manifest/(?:schema|template|validate)/?$|schemas/deployhub-v1[.]json/?$|_next/static|_next/image|favicon[.]ico$).*)',
  ],
};

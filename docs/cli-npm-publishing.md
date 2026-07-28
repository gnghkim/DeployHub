# DeployHub CLI npm 게시 절차

`@deployhub/cli`는 공개 스코프 패키지다. 실제 게시는 npm 권한을 가진 사람이
수행한다. 토큰이나 비밀번호를 파일, 명령 인자, 로그에 남기지 말고 자동화
에이전트에게 `npm login`이나 `npm publish`를 맡기지 않는다.

## 게시 전 확인

- Node.js 22 이상과 pnpm 9.15.0을 사용한다.
- 게시할 커밋을 체크아웃하고 작업 트리가 깨끗한지 확인한다.
- `packages/cli/package.json`의 버전이 npm에 아직 없는 버전인지 사람이
  확인한다.
- 패키지의 `dependencies`는 비어 있어야 한다. CLI의 런타임 모듈은 tsup이
  `dist/index.js`에 번들한다.

## 증명 절차

저장소 루트에서 다음 순서로 실행한다. 어느 단계든 실패하면 게시하지 않는다.

1. 잠금 파일과 패키지 선언의 일치를 확인한다.

   ```bash
   pnpm install --frozen-lockfile
   ```

2. CLI 타입을 검사한다.

   ```bash
   pnpm --filter @deployhub/cli typecheck
   ```

3. 전체 테스트를 실행한다.

   ```bash
   pnpm test
   ```

4. 게시할 CLI 번들을 만든다.

   ```bash
   pnpm --filter @deployhub/cli build
   ```

5. npm이 포함할 파일과 메타데이터를 dry-run으로 확인한다.

   ```bash
   cd packages/cli
   npm pack --dry-run
   cd ../..
   ```

   출력에는 `package.json`과 `dist/index.js`만 있어야 하며 소스, 테스트,
   `node_modules`는 없어야 한다.

6. tarball을 만들어 내용을 직접 검사한다. tarball은 저장소 밖 임시
   디렉터리에 둔다.

   ```bash
   TMP_DIR="$(mktemp -d)"
   TARBALL_NAME="$(npm pack ./packages/cli --pack-destination "$TMP_DIR")"
   TARBALL="$TMP_DIR/$TARBALL_NAME"
   tar -tf "$TARBALL"
   ```

7. 저장소 밖의 빈 디렉터리에 tarball을 설치하고 실제 명령을 실행한다.
   아래 URL은 로컬 검증용 값이며 네트워크 요청을 하지 않는다.

   ```bash
   INSTALL_DIR="$(mktemp -d)"
   cd "$INSTALL_DIR"
   npm init -y
   npm install "$TARBALL"
   DEPLOYHUB_URL=http://127.0.0.1 npx --no-install deployhub init --detect
   test -f deployhub.yaml
   ```

   `Wrote .../deployhub.yaml`, `INFERRED FIELDS`, `UNKNOWN FIELDS`가 출력되고
   `deployhub.yaml`이 생성되어야 한다.

## 게시

위 결과와 tarball 내용을 사람이 검토한 뒤, npm 인증이 이미 설정된 로컬
환경에서만 다음 명령을 실행한다.

```bash
cd packages/cli
npm publish
```

`publishConfig.access`가 `public`으로 고정되어 있으므로 별도 접근 수준 인자는
필요하지 않다. 게시 후 npm 패키지 페이지에서 버전, 실행 파일, MIT 라이선스를
확인한다.

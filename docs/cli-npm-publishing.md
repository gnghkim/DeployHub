# DeployHub CLI npm 게시 절차

`@deployhub/cli`는 공개 스코프 패키지다. 실제 게시는 npm 권한을 가진 사람이
수행한다. 토큰이나 비밀번호를 파일, 명령 인자, 로그에 남기지 말고 자동화
에이전트에게 `npm login`이나 `npm publish`를 맡기지 않는다.

## 최초 1회 — npm 조직을 만든다

`@deployhub/cli`는 `@deployhub` 스코프를 쓴다. **스코프는 npm 조직이므로 먼저
만들어야 한다.** 공개 패키지만 게시한다면 무료다.

1. https://www.npmjs.com/org/create 에서 조직 이름을 `deployhub`로 만든다
2. Free 플랜을 고른다 — 공개 패키지에 제한이 없다
3. `npm login`

**이 단계를 건너뛰면 게시가 404로 실패한다.** 메시지가 인증 문제처럼 보여
원인을 찾기 어렵다. 스코프가 없으면 레지스트리는 그 경로를 아예 모른다.

조직 이름은 한 번 만들면 바꿀 수 없다.

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
   pnpm publish --dry-run --no-git-checks
   cd ../..
   ```

   `public access`로 게시된다는 문구가 나와야 한다. 그 문구가 없으면
   `publishConfig.access`가 빠진 것이고, 그대로 게시하면 거부된다.

   **`npm pack --dry-run`으로 대신하지 마라.** 아래 6번의 이유와 같다.

6. tarball을 만들어 내용을 직접 검사한다. tarball은 저장소 밖 임시
   디렉터리에 둔다.

   ```bash
   TMP_DIR="$(mktemp -d)"
   cd packages/cli
   pnpm pack --pack-destination "$TMP_DIR"
   cd ../..
   TARBALL="$TMP_DIR/deployhub-cli-0.1.0.tgz"
   tar -tzf "$TARBALL"
   tar -xzOf "$TARBALL" package/package.json
   ```

   `pnpm pack`은 `--filter`를 통해 부르면 `--pack-destination`을 받지 못한다.
   `packages/cli`에서 직접 실행한다.

   Windows의 Git Bash에서는 `mktemp -d`가 만든 `/tmp/...` 경로를 Windows용
   `npm`이 읽지 못한다. `cygpath -w`로 변환하거나 처음부터 Windows 경로를 쓴다.

   `dist/index.js`, `package.json`, `LICENSE` 셋만 있어야 하며 소스, 테스트,
   `node_modules`는 없어야 한다.

   **`npm pack`이 아니라 `pnpm pack`이다.** 실제 게시를 `pnpm publish`로 하므로
   검사도 같은 도구로 해야 한다. 두 도구가 만드는 manifest가 다르다 —
   `npm pack`은 `devDependencies`의 `workspace:*`를 그대로 두고 `LICENSE`도
   담지 않는다. `npm pack` 결과를 검사하면 게시되지 않을 파일을 검사하는 셈이다.

   꺼낸 `package.json`에서 `dependencies`가 비어 있는지 눈으로 확인한다.

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
pnpm publish
```

**`npm publish`가 아니라 `pnpm publish`다.** 둘이 다르게 동작한다.

`devDependencies`에 `"@deployhub/manifest": "workspace:*"`가 남아 있다. 로컬
빌드에 필요해서 지울 수 없는데, `workspace:`는 npm 레지스트리가 모르는
프로토콜이다.

`pnpm publish`는 이것을 실제 버전(`0.0.0`)으로 치환해서 올린다. `npm publish`는
그대로 올린다. 소비자는 `devDependencies`를 설치하지 않으므로 실사용에는 차이가
없지만, 레지스트리에 올라간 manifest가 유효하지 않은 상태로 남는다.

`pnpm pack`은 `LICENSE`도 tarball에 함께 담는다. `npm pack`은 담지 않는다.

`publishConfig.access`가 `public`으로 고정되어 있으므로 별도 접근 수준 인자는
필요하지 않다. 게시 후 npm 패키지 페이지에서 버전, 실행 파일, MIT 라이선스를
확인한다.

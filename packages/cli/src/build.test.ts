import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
describe('built CLI', () => {
  // 이 훅은 tsup 번들을 통째로 다시 만든다. 단독으로는 1~2초지만 DB 테스트가
  // testcontainers 로 PostgreSQL 을 병렬로 띄우는 중이면 vitest 기본 제한인
  // 10초를 넘겨 이 파일만 간헐적으로 실패한다. 다른 무거운 훅과 같은 값을 준다.
  beforeAll(async () => {
    if (process.platform === 'win32') {
      await execFileAsync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm run build'],
        { cwd: packageDirectory },
      );
    } else {
      await execFileAsync('pnpm', ['run', 'build'], {
        cwd: packageDirectory,
      });
    }
  }, 120_000);

  it('runs as a standalone Node entrypoint', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', '--help'],
      { cwd: packageDirectory },
    );

    expect(stdout).toContain('register');
    expect(stdout).toContain('status');
    expect(stdout).not.toContain('--token');
  });

  it('never writes DEPLOYHUB_TOKEN to stdout or stderr on failure', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-cli-secret-'));
    const token = 'dh_reg_IDENTIFIABLE_PROCESS_SECRET_d1b5';
    await writeFile(
      join(rootDir, 'deployhub.yaml'),
      'apiVersion: deployhub.io/v1\nkind: Service\n',
    );

    let stdout = '';
    let stderr = '';
    try {
      await execFileAsync(
        process.execPath,
        [join(packageDirectory, 'dist', 'index.js'), 'register', '--draft'],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            DEPLOYHUB_TOKEN: token,
            DEPLOYHUB_URL: 'https://hub.example.invalid',
          },
        },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      stdout = failure.stdout ?? '';
      stderr = failure.stderr ?? '';
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }

    expect(`${stdout}\n${stderr}`).not.toContain(token);
    expect(`${stdout}\n${stderr}`).toContain('ERROR');
  });
});

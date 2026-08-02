import { spawnSync } from 'node:child_process';

const image = process.argv[2] ?? 'deployhub:local';
const verificationScript = String.raw`
const { readdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const pnpmRoot = '/app/node_modules/.pnpm';
const sharpPackage = readdirSync(pnpmRoot).find((name) => name.startsWith('sharp@0.35.3'));
if (!sharpPackage) throw new Error('sharp 0.35.3 is missing from the standalone image');

const sharpPath = pathToFileURL(
  pnpmRoot + '/' + sharpPackage + '/node_modules/sharp/dist/index.mjs',
).href;

import(sharpPath).then(async ({ default: sharp }) => {
  const output = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).webp().toBuffer();
  if (output.length === 0) throw new Error('sharp produced an empty image');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

const result = spawnSync(
  'docker',
  ['run', '--rm', '--entrypoint', 'node', image, '-e', verificationScript],
  { encoding: 'utf8' },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(`sharp runtime verified in ${image}\n`);

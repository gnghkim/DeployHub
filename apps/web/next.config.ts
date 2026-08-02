import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/*': [
      '../../node_modules/.pnpm/sharp@*/node_modules/sharp/**/*',
      '../../node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*',
    ],
  },
  typescript: { ignoreBuildErrors: true },
};
export default config;

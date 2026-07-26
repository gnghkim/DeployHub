import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
};
export default config;

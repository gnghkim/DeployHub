import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node22',
  // Playwright ships runtime assets and Sharp loads a platform-native addon;
  // both must remain runtime dependencies instead of being flattened by esbuild.
  external: ['playwright', 'sharp'],
});

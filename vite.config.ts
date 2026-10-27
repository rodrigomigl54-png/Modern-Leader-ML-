import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// One id per build: the running game compares it with version.json to notice a newer release.
const buildId = new Date().toISOString();

export default defineConfig({
  // GitHub Pages serves the site from /<repository name>/.
  base: '/Modern-Leader-ML-/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Date and time (UTC) of the build, shown in the corner to tell builds apart.
    __BUILD_DATE__: JSON.stringify(buildId.slice(0, 16).replace('T', ' ')),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    {
      name: 'version-file',
      // version.json next to index.html: never cached, it tells open tabs that a newer build exists.
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version, build: buildId }),
        });
      },
    },
  ],
  build: {
    // PixiJS alone is ~600 kB minified (~135 kB gzipped); one chunk is fine for this game.
    chunkSizeWarningLimit: 1024,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});

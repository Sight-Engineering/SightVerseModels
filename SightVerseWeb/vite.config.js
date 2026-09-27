import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                       // works from any sub-folder (GitHub Pages, Netlify, a CDN path...)
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
});

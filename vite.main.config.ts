import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
  resolve: {
    // Ensure native modules aren't bundled
    browserField: false,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});

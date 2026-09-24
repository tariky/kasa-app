// Renderer za Tauri: isti kao za Electron (vite.renderer.config.ts), s
// fiksnim portom za `tauri dev` i buildom u dist-tauri.
import { defineConfig, mergeConfig } from 'vite';
import renderer from './vite.renderer.config';

export default mergeConfig(renderer, defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist-tauri', emptyOutDir: true },
}));

import path from 'path';
import fs from 'fs';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
    icon: path.resolve(__dirname, 'src/assets/icon'),
    extraResource: [path.resolve(__dirname, 'src/assets/icon.png')],
  },
  rebuildConfig: {
    force: true,
  },
  makers: [
    new MakerSquirrel({
      setupIcon: path.resolve(__dirname, 'src/assets/icon.ico'),
      iconUrl: `file://${path.resolve(__dirname, 'src/assets/icon.ico')}`,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      // The Vite plugin doesn't copy node_modules for externalized native modules.
      // We need to manually copy better-sqlite3 and its runtime dependencies.
      const projectRoot = path.resolve(__dirname);
      const destModules = path.join(buildPath, 'node_modules');

      if (!fs.existsSync(destModules)) {
        fs.mkdirSync(destModules, { recursive: true });
      }

      const nativeModules = ['better-sqlite3', 'bindings', 'file-uri-to-path'];
      for (const mod of nativeModules) {
        const src = path.join(projectRoot, 'node_modules', mod);
        const dest = path.join(destModules, mod);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      console.log('[forge hook] Copied native modules:', nativeModules.join(', '));
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;

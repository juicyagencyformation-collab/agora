import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // wrangler.test.toml = wrangler.toml sans le binding [ai] (voir ce fichier pour le
      // pourquoi) — jamais wrangler.toml directement, sous peine d'exiger une authentification
      // Cloudflare distante rien que pour lancer `npm test`.
      wrangler: { configPath: './wrangler.test.toml' },
    }),
  ],
});

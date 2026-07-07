import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Expose Wrangler-configured vars/secrets (and `process.env`) during
    // `astro dev` via the Workers runtime proxy.
    platformProxy: { enabled: true },
  }),
  vite: {
    ssr: {
      // Leave Node built-ins unbundled — they are provided at runtime by the
      // Workers `nodejs_compat` flag (see wrangler.jsonc). Bundling them fails.
      external: ['node:crypto', 'node:buffer'],
    },
  },
});

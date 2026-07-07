/// <reference path="../.astro/types.d.ts" />
type KVNamespace = import('@cloudflare/workers-types').KVNamespace;
interface ENV {
  SIDDH_KV: KVNamespace;
  ADMIN_API_TOKEN: string;
}
type Runtime = import('@astrojs/cloudflare').Runtime<ENV>;
declare namespace App {
  interface Locals extends Runtime {}
}
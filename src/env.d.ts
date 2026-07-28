/// <reference path="../.astro/types.d.ts" />
declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
type KVNamespace = import('@cloudflare/workers-types').KVNamespace;
type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;
interface ENV {
  SIDDH_KV?: KVNamespace;
  SIDDH_DB?: D1Database;
  SIDDH_PDF?: R2Bucket;
  ADMIN_API_TOKEN?: string;
}
type Runtime = import('@astrojs/cloudflare').Runtime<ENV>;
declare namespace App {
  interface Locals extends Runtime {
    user: {
      id: string;
      email: string;
      fullName: string | null;
    } | null;
  }
}

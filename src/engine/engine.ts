/**
 * Worker-compatible loader for the vendored Swiss Ephemeris WASM build.
 *
 * The stock `swisseph-wasm` loader assumes a Node or browser filesystem (it
 * reads a 12 MB ephemeris `.data` file). We run in the Cloudflare Workers
 * runtime, so instead we:
 *   - feed the already-compiled `.wasm` module (imported statically, compiled
 *     at deploy time) via `instantiateWasm`, and
 *   - short-circuit the data-file loader with an empty package.
 *
 * We compute in Moshier mode (`SEFLG_MOSEPH`), which needs no data files and
 * still matches the full ephemeris to ~1 arc-second across the modern era —
 * far finer than Vedic chart work requires.
 */
import SwissEph from './swisseph.js';
import wasmModule from './swisseph.wasm';

let enginePromise: Promise<SwissEph> | null = null;

async function createEngine(): Promise<SwissEph> {
  const swe = new SwissEph();
  await swe.initSwissEph({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      receive(instance);
      return instance.exports;
    },
    // Moshier mode reads no ephemeris files; hand the loader an empty package
    // so it never tries to fetch/read the bundled `.data` file.
    getPreloadedPackage() {
      return new ArrayBuffer(0);
    },
    locateFile(path) {
      return path;
    },
  });
  return swe;
}

/**
 * Returns a lazily-initialised, cached Swiss Ephemeris instance. The WASM
 * module is compiled once (at first use) and reused across requests.
 */
export function getEphemeris(): Promise<SwissEph> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((err) => {
      // Reset so a later request can retry a transient init failure.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

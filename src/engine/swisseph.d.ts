/**
 * Minimal type surface for the vendored Swiss Ephemeris WASM wrapper
 * (`swisseph.js`). Only the members used by the chart engine are declared.
 */

export interface SwissEphInitConfig {
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance) => void,
  ) => WebAssembly.Exports | Record<string, unknown>;
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  locateFile?: (path: string, prefix?: string) => string;
}

export interface HousesResult {
  cusps: Float64Array;
  ascmc: Float64Array;
}

export default class SwissEph {
  // Bodies
  readonly SE_SUN: number;
  readonly SE_MOON: number;
  readonly SE_MERCURY: number;
  readonly SE_VENUS: number;
  readonly SE_MARS: number;
  readonly SE_JUPITER: number;
  readonly SE_SATURN: number;
  readonly SE_MEAN_NODE: number;
  readonly SE_TRUE_NODE: number;

  // Flags
  readonly SEFLG_MOSEPH: number;
  readonly SEFLG_SPEED: number;
  readonly SEFLG_SIDEREAL: number;

  // Sidereal modes / calendar
  readonly SE_SIDM_LAHIRI: number;
  readonly SE_GREG_CAL: number;

  constructor();
  initSwissEph(config?: SwissEphInitConfig): Promise<void>;
  set_ephe_path(path: string): void;
  set_sid_mode(sidMode: number, t0: number, ayanT0: number): void;
  get_ayanamsa(julianDay: number): number;
  julday(year: number, month: number, day: number, hour: number): number;
  /** Returns [longitude, latitude, distance, lonSpeed, ...]. */
  calc_ut(julianDay: number, body: number, flags: number): Float64Array;
  houses_ex(
    julianDay: number,
    iflag: number,
    geoLat: number,
    geoLon: number,
    houseSystem: string,
  ): HousesResult;
  close(): void;
}

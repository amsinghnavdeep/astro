declare module '*.txt' {
  const text: string;
  export default text;
}

declare module '*.wasm' {
  const mod: WebAssembly.Module;
  export default mod;
}

// Playwright tests run in Node, but the project tsconfig has no Node typings
// (none are needed elsewhere), so the one Node API the tests use is declared here.
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

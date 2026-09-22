/**
 * Tells an error thrown from inside the SDK's own code (or a dependency it
 * pulls in, such as `web-vitals`) apart from one thrown by the application.
 *
 * Only the frame the error originated in is consulted: application code that
 * runs inside an SDK callback (`beforeSend`, a wrapped `fetch`) still has its
 * own file at the top of the stack and stays an application error. The
 * decision is made from the frame's file only, so a build that inlines the
 * SDK into the application's own chunk cannot be told apart and is treated
 * as application code — a false "app" beats a false "sdk".
 */
const SDK_FILE_PATTERNS: RegExp[] = [
  // Unbundled (dev servers, CDN): node_modules/@base-14/scout-react/dist/…
  /scout-react/,
  // Our runtime dependency, bundled next to us or served unbundled.
  /web-vitals/,
  // A bundler chunk named after the package (Vite `manualChunks: { scout }`,
  // Rollup `[name]-[hash]`): assets/scout-LfkEtGwo.js
  /[\\/]scout-[A-Za-z0-9_-]{4,}\.m?js$/,
];
/**
 * The file (URL or path, without line/column) of the frame an error was
 * thrown from, or null when the stack carries no frame. Understands V8
 * (`at fn (url:1:2)`, `at url:1:2`) and JavaScriptCore / SpiderMonkey
 * (`fn@url:1:2`) frame shapes.
 */
export function originFrameFile(stack: string | undefined): string | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
    const m = line.match(/([^\s()@]+):\d+:\d+\)?\s*$/);
    if (m && m[1]) return m[1];
  }
  return null;
}
export function isSdkOriginStack(stack: string | undefined): boolean {
  const file = originFrameFile(stack);
  if (!file) return false;
  return SDK_FILE_PATTERNS.some((p) => p.test(file));
}

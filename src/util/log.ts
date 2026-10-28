/**
 * Logging. stdout is reserved for the MCP protocol, so everything goes to stderr.
 * We never log conversation content, transcripts or file contents.
 */
const DEBUG = process.env.VIBE_DEBUG === '1';

export const log = {
  info(msg: string): void {
    process.stderr.write(`[vibeediting] ${msg}\n`);
  },
  debug(msg: string): void {
    if (DEBUG) process.stderr.write(`[vibeediting:debug] ${msg}\n`);
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : '';
    process.stderr.write(`[vibeediting:error] ${msg}${detail}\n`);
  },
};

/** Route stray console.log calls (ours or from dependencies) to stderr so they cannot corrupt stdio. */
export function protectStdout(): void {
  /* eslint-disable no-console */
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.debug = (...args: unknown[]) => console.error(...args);
  /* eslint-enable no-console */
}

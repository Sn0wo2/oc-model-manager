export const log = {
  ok: (message: string): void => console.log(`[v] ${message}`),
  error: (message: string): void => console.log(`[x] ${message}`),
  warn: (message: string): void => console.log(`[!] ${message}`),
  info: (message: string): void => console.log(`[i] ${message}`),
  run: (message: string): void => console.log(`[>] ${message}`),
  header: (message: string): void => console.log(`\n=== ${message} ===`),
};

export function fail(error: unknown): never {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

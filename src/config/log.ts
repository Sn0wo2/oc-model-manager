export const log = {
  ok: (message: string) => console.log(`[v] ${message}`),
  error: (message: string) => console.log(`[x] ${message}`),
  warn: (message: string) => console.log(`[!] ${message}`),
  info: (message: string) => console.log(`[i] ${message}`),
  run: (message: string) => console.log(`[>] ${message}`),
  header: (message: string) => console.log(`\n=== ${message} ===`),
}

export function fail(error: unknown): never {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

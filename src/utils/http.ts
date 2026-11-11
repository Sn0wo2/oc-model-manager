import { FetchError, ofetch } from "ofetch"
import { log } from "./log.ts"

export async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    return await ofetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...headers,
      },
      retry: 0,
      timeout: 30_000,
    })
  } catch (error) {
    const endpoint = URL.parse(url)
    const target = endpoint ? `${endpoint.origin}${endpoint.pathname}` : "<invalid endpoint>"
    if (error instanceof FetchError && error.status)
      log.error(`HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ""}: ${target}`)
    else log.error(`network error: ${target}`)
    return null
  }
}

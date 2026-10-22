import { log } from "../config/log.ts";

export async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  try {
    const parsed = new URL(url);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const hint = (
        {
          401: "invalid API key",
          403: "forbidden",
          404: "not found",
          429: "rate limited",
        } satisfies Record<number, string>
      )[response.status];
      log.error(
        `HTTP ${response.status}${hint ? ` (${hint})` : ""}: ${parsed.origin}${parsed.pathname}`,
      );
      return { error: String(response.status) };
    }
    return await response.json();
  } catch (error) {
    log.error(
      `network error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { error: String(error) };
  }
}

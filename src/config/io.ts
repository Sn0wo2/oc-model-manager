import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { writeFileSync } from "atomically"
import { isEqual, isPlainObject } from "es-toolkit/predicate"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { z } from "zod"
import { log } from "../utils/log.ts"
import { type OpenCodeConfig, openCodeConfigSchema } from "./schema.ts"

export function defaultConfigPath() {
  const { OPENCODE_CONFIG_DIR, XDG_CONFIG_HOME } = process.env
  const directory =
    OPENCODE_CONFIG_DIR?.trim() || join(XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), "opencode")
  const fallback = join(directory, "opencode.jsonc")
  const json = join(directory, "opencode.json")
  return existsSync(json) && !existsSync(fallback) ? json : fallback
}

function parseConfig(text: string, source: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  const [first] = errors
  if (first) throw new SyntaxError(`${source}: JSONC syntax error near offset ${first.offset} (code ${first.error})`)
  if (!isPlainObject(config)) throw new TypeError(`${source} must be an object`)
  return config
}

export function loadConfig(configPath: string) {
  if (!existsSync(configPath)) return {}
  const document = parseConfig(readFileSync(configPath, "utf8"), configPath)
  const parsed = openCodeConfigSchema.safeParse(document)
  if (!parsed.success) throw new SyntaxError(`${configPath}: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export function saveConfig(configPath: string, config: OpenCodeConfig) {
  const original = existsSync(configPath) ? readFileSync(configPath, "utf8") : null
  let text = JSON.stringify(config, null, 2)
  if (original !== null) {
    const previous = parseConfig(original, configPath)
    text = original
    for (const key of new Set([...Object.keys(previous), ...Object.keys(config)])) {
      if (key in config && isEqual(previous[key], config[key])) continue
      text = applyEdits(
        text,
        modify(text, [key], key in config ? config[key] : undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
        }),
      )
    }
  }
  writeFileSync(configPath, text, { encoding: "utf8", mode: 0o600 })
  log.ok(`saved to ${configPath}`)
}

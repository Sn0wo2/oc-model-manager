import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { isPlainObject as isRecord } from "es-toolkit/predicate";

import type { OpenCodeConfig } from "./types.ts";
import { log } from "./log.ts";

export function defaultConfigPath(): string {
  const globalDirectory =
    process.env.OPENCODE_CONFIG_DIR?.trim() ||
    join(
      process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
      "opencode",
    );
  const candidates = ["opencode.json", "opencode.jsonc"].map((name) =>
    join(globalDirectory, name),
  );
  return (
    candidates.filter((path) => existsSync(path)).at(-1) ?? candidates.at(-1)!
  );
}

function parseConfig(
  text: string,
  source = "OpenCode config",
): Record<string, unknown> {
  const errors: ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first)
    throw new SyntaxError(
      `${source}: JSONC syntax error near offset ${first.offset} (code ${first.error})`,
    );
  if (!isRecord(config)) throw new TypeError(`${source} must be an object`);
  return config;
}

export function loadConfig(configPath: string): OpenCodeConfig {
  if (!existsSync(configPath)) return {};
  const document = parseConfig(readFileSync(configPath, "utf8"), configPath);
  const providers = document.providers;
  if (providers !== undefined) {
    if (!isRecord(providers))
      throw new TypeError("config field 'providers' must be an object");
    for (const [name, entry] of Object.entries(providers)) {
      if (!isRecord(entry))
        throw new TypeError(`provider '${name}' must be an object`);
      const models = entry.models;
      if (models !== undefined && !isRecord(models)) {
        throw new TypeError(`provider '${name}.models' must be an object`);
      }
      const settings = entry.settings;
      if (settings !== undefined && !isRecord(settings)) {
        throw new TypeError(`provider '${name}.settings' must be an object`);
      }
      for (const [id, meta] of Object.entries(models ?? {})) {
        if (!isRecord(meta))
          throw new TypeError(
            `provider '${name}.models.${id}' must be an object`,
          );
      }
    }
  }
  const agents = document.agents;
  if (agents !== undefined) {
    if (!isRecord(agents))
      throw new TypeError("config field 'agents' must be an object");
    for (const [name, entry] of Object.entries(agents)) {
      if (entry !== undefined && !isRecord(entry))
        throw new TypeError(`agent '${name}' must be an object`);
    }
  }
  return document as OpenCodeConfig;
}

export function saveConfig(configPath: string, config: OpenCodeConfig): void {
  const original = existsSync(configPath)
    ? readFileSync(configPath, "utf8")
    : null;
  let text = JSON.stringify(config, null, 2);
  if (original !== null) {
    const previous = parseConfig(original, configPath);
    text = original;
    for (const key of new Set([
      ...Object.keys(previous),
      ...Object.keys(config),
    ])) {
      const exists = key in config;
      const value = exists ? config[key] : undefined;
      if (exists && JSON.stringify(previous[key]) === JSON.stringify(value))
        continue;
      text = applyEdits(
        text,
        modify(text, [key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
        }),
      );
    }
  }
  const temporary = join(dirname(configPath), `.tmp-${randomUUID()}`);
  mkdirSync(dirname(configPath), { recursive: true });
  try {
    writeFileSync(temporary, text, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, configPath);
  } finally {
    rmSync(temporary, { force: true });
  }
  log.ok(`saved to ${configPath}`);
}

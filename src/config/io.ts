import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyEdits, modify } from "jsonc-parser";
import { isPlainObject as isRecord } from "es-toolkit/predicate";
import { configPaths, parseConfig } from "@sn0wo2/oc-utils";

import type { OpenCodeConfig } from "./types.ts";
import { log } from "./log.ts";

export function defaultConfigPath(): string {
  const candidates = configPaths();
  return (
    candidates.filter((path) => existsSync(path)).at(-1) ?? candidates.at(-1)!
  );
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

const FORMAT_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
} as const;

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
      if (!(key in config)) {
        text = applyEdits(
          text,
          modify(text, [key], undefined, {
            formattingOptions: FORMAT_OPTIONS,
          }),
        );
      } else if (
        JSON.stringify(previous[key]) !== JSON.stringify(config[key])
      ) {
        text = applyEdits(
          text,
          modify(text, [key], config[key], {
            formattingOptions: FORMAT_OPTIONS,
          }),
        );
      }
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

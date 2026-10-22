import { isPlainObject as isRecord, isString } from "es-toolkit/predicate";
import { defaultConfigPath, loadConfig, saveConfig } from "../config/io.ts";
import { log } from "../config/log.ts";
import { fetchJson } from "../utils/http.ts";
import { formatDisplayName, sortedByName } from "../model/display.ts";
import {
  FORMAT_KEYS,
  SDK_FORMATS,
  packageForFormat,
  type FormatKey,
} from "./formats.ts";
import type {
  JsonObject,
  OpenCodeConfig,
  ProviderConfig,
  ProviderModel,
} from "../config/types.ts";

const PACKAGE_TO_FORMAT: ReadonlyMap<string, FormatKey> = new Map(
  FORMAT_KEYS.map((format) => [SDK_FORMATS[format].package, format]),
);
const FETCH_CONCURRENCY = 4;

export class ModelSync {
  readonly config: OpenCodeConfig;
  private readonly fetched = new Map<string, readonly string[] | null>();

  constructor(readonly configPath = defaultConfigPath()) {
    this.config = loadConfig(configPath);
  }

  async fetchModelIds(
    name: string,
    provider: ProviderConfig,
  ): Promise<readonly string[] | null> {
    const cached = this.fetched.get(name);
    if (cached !== undefined) return cached;
    const result = await this.fetchModels(name, provider);
    this.fetched.set(name, result);
    return result;
  }

  private async fetchModels(
    name: string,
    provider: ProviderConfig,
  ): Promise<readonly string[] | null> {
    const settings = provider.settings ?? {};
    const format =
      PACKAGE_TO_FORMAT.get(
        (isString(provider.package) ? provider.package : "").replace(
          /^aisdk:/,
          "",
        ),
      ) || "openai";
    const sdk = SDK_FORMATS[format];
    const customBaseURL = isString(settings.baseURL)
      ? settings.baseURL
      : undefined;
    if (sdk.discovery === "catalog" && !customBaseURL) {
      log.info(
        `${name} is managed by OpenCode V2's model catalog; provide --base-url to sync a custom endpoint`,
      );
      return null;
    }
    const baseURL = customBaseURL || sdk.baseURL;
    if (!baseURL) {
      log.warn(`no model endpoint configured for ${name}`);
      return null;
    }
    const apiKey = isString(settings.apiKey) ? settings.apiKey : "";
    const endpoint = baseURL.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    let url: string;
    if (format === "gemini") {
      url = `${endpoint}/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`;
    } else {
      if (format === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
        if (apiKey) headers["x-api-key"] = apiKey;
      } else if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      url = endpoint.endsWith("/models") ? endpoint : `${endpoint}/models`;
    }
    log.run(`fetching models from ${name}...`);
    const data = await fetchJson(url, headers);
    if (
      (!isRecord(data) && !Array.isArray(data)) ||
      (isRecord(data) && "error" in data)
    ) {
      log.error(`failed to fetch models from ${name}`);
      return null;
    }
    const modelIds =
      format === "gemini"
        ? Array.isArray(data) || !Array.isArray(data.models)
          ? []
          : data.models.flatMap((item) => {
              const id =
                isRecord(item) && isString(item.name) ? item.name : undefined;
              return id ? [id.replace(/^models\//, "")] : [];
            })
        : (Array.isArray(data)
            ? data
            : isRecord(data)
              ? ([data.data, data.models].find(Array.isArray) ?? [])
              : []
          ).flatMap((item) => {
            const id =
              typeof item === "string"
                ? item.trim() || undefined
                : isRecord(item)
                  ? (["id", "name", "model"] as const)
                      .map((key) =>
                        isString(item[key]) ? item[key].trim() : undefined,
                      )
                      .find(Boolean)
                  : undefined;
            return id ? [id] : [];
          });
    if (!modelIds.length) {
      log.warn(`no models found for ${name}`);
      return null;
    }
    return modelIds;
  }

  private async syncProvider(
    name: string,
    provider: ProviderConfig,
    selection?: readonly string[],
    context?: number,
  ): Promise<boolean> {
    const modelIds = await this.fetchModelIds(name, provider);
    if (!modelIds) return false;
    log.ok(`found ${modelIds.length} models`);
    const selectedModels = selection?.length ? new Set(selection) : undefined;
    const selected = selectedModels
      ? modelIds.filter((modelId) => selectedModels.has(modelId))
      : modelIds;
    if (!selected.length) {
      log.warn("no models selected, skipping");
      return false;
    }
    log.run(`building ${selected.length} models...`);
    const models: Record<string, ProviderModel> = {};
    for (const modelId of selected) {
      const model = provider.models?.[modelId] ?? {};
      models[modelId] =
        context === undefined
          ? model
          : { ...model, limit: { ...model.limit, context } };
      log.ok(`  ${formatDisplayName(modelId)}`);
    }
    provider.models = Object.fromEntries(
      Object.entries(models).sort(([left], [right]) =>
        formatDisplayName(left).localeCompare(formatDisplayName(right)),
      ),
    );
    (this.config.providers ??= {})[name] = provider;
    log.ok(`updated ${name} (${Object.keys(models).length} models)`);
    return true;
  }

  async addProvider(
    name: string,
    format: FormatKey,
    credentials?: { baseURL?: string; apiKey?: string },
    selection?: readonly string[],
    context?: number,
  ): Promise<void> {
    const settings: JsonObject = {};
    const baseURL = credentials?.baseURL || SDK_FORMATS[format].baseURL;
    if (baseURL) settings.baseURL = baseURL;
    if (credentials?.apiKey) settings.apiKey = credentials.apiKey;
    const existing = this.config.providers?.[name];
    const updated = await this.syncProvider(
      name,
      {
        ...existing,
        package: packageForFormat(format),
        settings: { ...existing?.settings, ...settings },
      },
      selection,
      context,
    );
    if (updated) saveConfig(this.configPath, this.config);
  }

  async syncProviders(
    names?: readonly string[],
    selection?: readonly string[],
    context?: number,
  ): Promise<void> {
    const providers = (this.config.providers ??= {});
    const known = sortedByName(Object.keys(providers));
    if (!known.length) {
      log.warn("no providers configured");
      return;
    }
    const selected = names?.length
      ? names.filter((name) => {
          if (!providers[name]) {
            log.warn(`unknown provider: ${name}`);
            return false;
          }
          return true;
        })
      : known;
    if (!selected.length) return;
    if (selection?.length && selected.length !== 1)
      throw new TypeError("--models requires exactly one provider");
    for (let start = 0; start < selected.length; start += FETCH_CONCURRENCY) {
      await Promise.all(
        selected
          .slice(start, start + FETCH_CONCURRENCY)
          .map((name) => this.fetchModelIds(name, providers[name]!)),
      );
    }
    let updated = false;
    for (const name of selected) {
      const provider = providers[name];
      if (
        provider &&
        (await this.syncProvider(name, provider, selection, context))
      )
        updated = true;
    }
    if (updated) saveConfig(this.configPath, this.config);
  }

  deleteProvider(name: string): void {
    const providers = (this.config.providers ??= {});
    if (!providers[name]) {
      log.warn(`unknown provider: ${name}`);
      return;
    }
    delete providers[name];
    log.ok(`deleted ${name}`);
    saveConfig(this.configPath, this.config);
  }

  listProviders(): Array<{
    name: string;
    format: string;
    models: number;
  }> {
    const providers = this.config.providers ?? {};
    return sortedByName(Object.keys(providers)).map((name) => {
      const provider = providers[name] ?? {};
      return {
        name,
        format:
          PACKAGE_TO_FORMAT.get(
            (isString(provider.package) ? provider.package : "").replace(
              /^aisdk:/,
              "",
            ),
          ) ?? "unknown",
        models: Object.keys(provider.models ?? {}).length,
      };
    });
  }
}

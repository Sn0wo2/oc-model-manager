import { compact, intersection, mapAsync } from "es-toolkit/array"
import { z } from "zod"
import { loadConfig, saveConfig } from "../config/io.ts"
import type { OpenCodeConfig, ProviderConfig } from "../config/schema.ts"
import { formatDisplayName, sortedByName } from "../model/display.ts"
import { fetchJson } from "../utils/http.ts"
import { log } from "../utils/log.ts"
import { FORMAT_KEYS, type FormatKey, parsePackage, SDK_FORMATS } from "./formats.ts"

const modelEntrySchema = z.union([
  z.string(),
  z.looseObject({ id: z.string().optional(), name: z.string().optional(), model: z.string().optional() }),
])
const modelResponseSchema = z
  .union([
    z.array(z.unknown()),
    z.looseObject({
      error: z.never().optional(),
      data: z.unknown().optional(),
      models: z.unknown().optional(),
    }),
  ])
  .transform((response) => {
    const items = Array.isArray(response) ? response : ([response.data, response.models].find(Array.isArray) ?? [])
    return items.flatMap((item) => {
      const parsed = modelEntrySchema.safeParse(item)
      if (!parsed.success) return []
      const { data } = parsed
      const id =
        typeof data === "string"
          ? data.trim()
          : compact([data.id, data.name, data.model].map((value) => value?.trim()))[0]
      return id ? [id] : []
    })
  })
const TRAILING_SLASH = /\/$/
const MODELS_PREFIX = /^models\//

export class ModelSync {
  readonly config: OpenCodeConfig
  private readonly fetched = new Map<string, readonly string[] | null>()

  constructor(readonly configPath: string) {
    this.config = loadConfig(configPath)
  }

  async fetchModelIds(name: string, provider: ProviderConfig) {
    const cached = this.fetched.get(name)
    if (cached !== undefined) return cached
    const result = await this.fetchModels(name, provider)
    this.fetched.set(name, result)
    return result
  }

  private async fetchModels(name: string, provider: ProviderConfig) {
    const { baseURL: settingURL, apiKey: settingKey } = provider.settings ?? {}
    const format = FORMAT_KEYS.find((key) => SDK_FORMATS[key].package === parsePackage(provider.package)) ?? "openai"
    const sdk = SDK_FORMATS[format]
    const customBaseURL = typeof settingURL === "string" ? settingURL : undefined
    if (sdk.discovery === "catalog" && !customBaseURL) {
      log.info(`${name} is managed by OpenCode V2's model catalog; provide --base-url to sync a custom endpoint`)
      return null
    }
    const baseURL = customBaseURL || sdk.baseURL
    if (!baseURL) {
      log.warn(`no model endpoint configured for ${name}`)
      return null
    }
    const apiKey = typeof settingKey === "string" ? settingKey : ""
    const endpoint = baseURL.replace(TRAILING_SLASH, "")
    const headers =
      format === "anthropic"
        ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) }
        : format === "gemini" || !apiKey
          ? {}
          : { Authorization: `Bearer ${apiKey}` }
    const url =
      format === "gemini"
        ? `${endpoint}/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`
        : endpoint.endsWith("/models")
          ? endpoint
          : `${endpoint}/models`
    log.run(`fetching models from ${name}...`)
    const response = modelResponseSchema.safeParse(await fetchJson(url, headers))
    if (!response.success) {
      log.error(`failed to fetch models from ${name}`)
      return null
    }
    if (!response.data.length) {
      log.warn(`no models found for ${name}`)
      return null
    }
    return response.data.map((id) => (format === "gemini" ? id.replace(MODELS_PREFIX, "") : id))
  }

  private async syncProvider(name: string, provider: ProviderConfig, selection?: readonly string[], context?: number) {
    const modelIds = await this.fetchModelIds(name, provider)
    if (!modelIds) return false
    log.ok(`found ${modelIds.length} models`)
    const selected = selection?.length ? intersection(modelIds, selection) : modelIds
    if (!selected.length) {
      log.warn("no models selected, skipping")
      return false
    }
    log.run(`building ${selected.length} models...`)
    provider.models = Object.fromEntries(
      sortedByName(selected).map((modelId) => {
        const model = provider.models?.[modelId] ?? {}
        log.ok(`  ${formatDisplayName(modelId)}`)
        return [modelId, context === undefined ? model : { ...model, limit: { ...model.limit, context } }]
      }),
    )
    this.config.providers ??= {}
    this.config.providers[name] = provider
    log.ok(`updated ${name} (${selected.length} models)`)
    return true
  }

  async addProvider(
    name: string,
    format: FormatKey,
    credentials: { baseURL?: string | undefined; apiKey?: string | undefined } = {},
    selection?: readonly string[],
    context?: number,
  ) {
    const baseURL = credentials.baseURL || SDK_FORMATS[format].baseURL
    const settings = {
      ...(baseURL ? { baseURL } : {}),
      ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    }
    const existing = this.config.providers?.[name]
    const updated = await this.syncProvider(
      name,
      {
        ...existing,
        package: `aisdk:${SDK_FORMATS[format].package}`,
        settings: { ...existing?.settings, ...settings },
      },
      selection,
      context,
    )
    if (updated) saveConfig(this.configPath, this.config)
  }

  editProvider(
    name: string,
    changes: { format?: FormatKey | undefined; baseURL?: string | undefined; apiKey?: string | undefined },
  ) {
    const provider = this.config.providers?.[name]
    if (!provider) {
      log.warn(`unknown provider: ${name}`)
      return
    }
    const { format, baseURL, apiKey } = changes
    const formatChanged = format !== undefined && SDK_FORMATS[format].package !== parsePackage(provider.package)
    const { baseURL: storedURL, apiKey: storedKey, ...rest } = provider.settings ?? {}
    const nextURL =
      baseURL === "" ? undefined : (baseURL ?? (formatChanged && format ? SDK_FORMATS[format].baseURL : storedURL))
    const nextKey = apiKey === "" || formatChanged ? apiKey || undefined : (apiKey ?? storedKey)
    if (formatChanged && storedKey && !apiKey)
      log.warn(`cleared the stored API key for ${name}; pass --api-key to set a new one`)
    if (format !== undefined) provider.package = `aisdk:${SDK_FORMATS[format].package}`
    if (format !== undefined || baseURL !== undefined || apiKey !== undefined)
      provider.settings = {
        ...rest,
        ...(nextURL ? { baseURL: nextURL } : {}),
        ...(nextKey ? { apiKey: nextKey } : {}),
      }
    this.fetched.delete(name)
    saveConfig(this.configPath, this.config)
    log.ok(`updated ${name}`)
  }

  async syncProviders(names?: readonly string[], selection?: readonly string[], context?: number) {
    const providers = this.config.providers
    const known = sortedByName(Object.keys(providers ?? {}))
    if (!known.length) {
      log.warn("no providers configured")
      return
    }
    const selected = (
      names?.length
        ? names.filter((name) => {
            if (providers?.[name]) return true
            log.warn(`unknown provider: ${name}`)
            return false
          })
        : known
    ).flatMap((name) => {
      const provider = providers?.[name]
      return provider ? [{ name, provider }] : []
    })
    if (!selected.length) return
    if (selection?.length && selected.length !== 1) throw new TypeError("--models requires exactly one provider")
    const results = await mapAsync(
      selected,
      ({ name, provider }) => this.syncProvider(name, provider, selection, context),
      { concurrency: 4 },
    )
    if (results.some(Boolean)) saveConfig(this.configPath, this.config)
  }

  deleteProvider(name: string) {
    const providers = this.config.providers
    if (!providers?.[name]) {
      log.warn(`unknown provider: ${name}`)
      return
    }
    delete providers[name]
    log.ok(`deleted ${name}`)
    saveConfig(this.configPath, this.config)
  }

  listProviders() {
    const providers = this.config.providers ?? {}
    return sortedByName(Object.keys(providers)).map((name) => {
      const provider = providers[name] ?? {}
      return {
        name,
        package: parsePackage(provider.package) ?? "",
        models: Object.keys(provider.models ?? {}).length,
      }
    })
  }
}

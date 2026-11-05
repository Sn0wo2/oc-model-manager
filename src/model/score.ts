import type { OpenCodeConfig, ProviderModel } from "../config/schema.ts"

export type Role = "strong" | "balanced" | "fast"

type Tier = "reasoning" | "flagship" | "fast" | "balanced" | "standard"
interface ModelTraits {
  family: string
  tier: Tier
}

const traitsCache = new Map<string, ModelTraits>()
const MODEL_TOKEN_PATTERN = /\d+\.\d+|[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+/g
const STARTS_WITH_LETTER = /^[a-z]/
const NUMERIC_TOKEN = /^\d+(?:\.\d+)?$/
const TRAILING_DIGITS = /\d+$/

const TIER_KEYWORDS: readonly (readonly [Tier, readonly string[]])[] = [
  ["reasoning", ["r1", "reasoning", "thinking", "deepthink", "codex"]],
  ["flagship", ["opus", "pro", "ultra", "max", "plus", "advanced", "flagship", "large", "huge"]],
  ["fast", ["nano", "haiku", "spark", "turbo", "speed", "micro", "small", "tiny"]],
  ["balanced", ["sonnet", "flash", "lite", "mini", "standard", "medium", "base", "chat"]],
]

function scoreModelAuto(modelName: string): ModelTraits {
  const cached = traitsCache.get(modelName)
  if (cached) return cached
  const tokens = (modelName.split("/").at(-1) ?? modelName).toLowerCase().match(MODEL_TOKEN_PATTERN) ?? []
  const familyIndex = tokens.findIndex((token) => STARTS_WITH_LETTER.test(token) && !NUMERIC_TOKEN.test(token))
  const familyToken = tokens[familyIndex]
  const family = familyToken?.replace(TRAILING_DIGITS, "") || familyToken || "unknown"
  const variants = tokens.filter((_, index) => index !== familyIndex)
  const traits = {
    family,
    tier: TIER_KEYWORDS.find(([, words]) => words.some((word) => variants.includes(word)))?.[0] ?? "standard",
  }
  traitsCache.set(modelName, traits)
  return traits
}

const ROLE_WEIGHTS = {
  strong: {
    reasoning: 45,
    tool_call: 18,
    not_fast: 10,
    context: 100_000,
    variant: 4,
    multimodal: 4,
    tier: 6,
  },
  balanced: {
    reasoning: 26,
    tool_call: 12,
    not_fast: 6,
    context: 200_000,
    variant: 3,
    multimodal: 4,
    tier: 6,
    cost_penalty: 8,
  },
  fast: { fast: 32, tool_call: 10, reasoning: 6, cost_1: 10, cost_03: 4 },
} as const

export class ModelScorer {
  readonly catalog = new Map<string, ProviderModel>()
  readonly providers = new Map<string, string[]>()

  constructor(config: OpenCodeConfig) {
    for (const [provider, providerConfig] of Object.entries(config.providers ?? {})) {
      const ids: string[] = []
      for (const [modelId, meta] of Object.entries(providerConfig.models ?? {})) {
        const fullId = `${provider}/${modelId}`
        this.catalog.set(fullId, meta)
        ids.push(fullId)
      }
      this.providers.set(provider, ids)
    }
  }

  variants(model: string) {
    return this.catalog.get(model)?.variants?.map((variant) => variant.id) ?? []
  }

  score(model: string, role: Role): number {
    const meta = this.catalog.get(model)
    const baseCost = meta?.cost?.input
    let fast = baseCost !== undefined && baseCost <= 1.5
    if (!fast) {
      const family =
        meta?.family && meta.family !== "unknown" ? meta.family.toLowerCase() : scoreModelAuto(model).family
      const lower = model.toLowerCase()
      fast = ["mini", "nano", "flash", "haiku", "spark"].some(
        (keyword) => family.includes(keyword) || lower.includes(keyword),
      )
    }
    if (role === "fast") {
      const weights = ROLE_WEIGHTS.fast
      let score = 0
      if (meta?.variants?.length) score += weights.reasoning
      if (meta?.capabilities?.tools) score += weights.tool_call
      if (fast) score += weights.fast
      const cost = baseCost ?? Number.POSITIVE_INFINITY
      if (cost <= 1) score += weights.cost_1
      if (cost <= 0.3) score += weights.cost_03
      return score
    }
    const weights = ROLE_WEIGHTS[role]
    let score = 0
    if (meta?.variants?.length) score += weights.reasoning
    if (meta?.capabilities?.tools) score += weights.tool_call
    if (!fast) score += weights.not_fast
    score += Math.min(Math.floor((meta?.limit?.context ?? 0) / weights.context), role === "strong" ? 12 : 8)
    score += (meta?.variants?.length ?? 0) * weights.variant
    if (meta?.capabilities?.input?.some((value) => ["image", "pdf", "audio", "video"].includes(value)))
      score += weights.multimodal
    const tier = scoreModelAuto(model).tier
    if (tier === "flagship" || (role === "balanced" && tier === "balanced")) score += weights.tier
    if (role === "balanced")
      score -= Math.min(Math.trunc(baseCost ?? Number.POSITIVE_INFINITY), ROLE_WEIGHTS.balanced.cost_penalty)
    return score
  }
}

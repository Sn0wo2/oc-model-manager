import { isPlainObject as isRecord } from "es-toolkit/predicate";
import type { OpenCodeConfig, ProviderModel } from "../config/types.ts";

export type Role = "strong" | "balanced" | "fast";

type Tier = "reasoning" | "flagship" | "fast" | "balanced" | "standard";
interface ModelTraits {
  family: string;
  tier: Tier;
}

const traitsCache = new Map<string, ModelTraits>();

function scoreModelAuto(modelName: string): ModelTraits {
  const cached = traitsCache.get(modelName);
  if (cached) return cached;
  const tokens =
    (modelName.split("/").at(-1) ?? modelName)
      .toLowerCase()
      .match(/\d+\.\d+|[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+/g) ?? [];
  const familyIndex = tokens.findIndex(
    (token) => /^[a-z]/.test(token) && !/^\d+(?:\.\d+)?$/.test(token),
  );
  const familyToken = tokens[familyIndex];
  const family = familyToken?.replace(/\d+$/, "") || familyToken || "unknown";
  const variants = tokens.filter((_, index) => index !== familyIndex);
  const traits = {
    family,
    tier: ["r1", "reasoning", "thinking", "deepthink", "codex"].some((word) =>
      variants.includes(word),
    )
      ? "reasoning"
      : [
            "opus",
            "pro",
            "ultra",
            "max",
            "plus",
            "advanced",
            "flagship",
            "large",
            "huge",
          ].some((word) => variants.includes(word))
        ? "flagship"
        : [
              "nano",
              "haiku",
              "spark",
              "turbo",
              "speed",
              "micro",
              "small",
              "tiny",
            ].some((word) => variants.includes(word))
          ? "fast"
          : [
                "sonnet",
                "flash",
                "lite",
                "mini",
                "standard",
                "medium",
                "base",
                "chat",
              ].some((word) => variants.includes(word))
            ? "balanced"
            : "standard",
  } satisfies ModelTraits;
  traitsCache.set(modelName, traits);
  return traits;
}

const ROLE_WEIGHTS = {
  strong: {
    reasoning: 45,
    tool_call: 18,
    not_fast: 10,
    context: 100000,
    variant: 4,
    multimodal: 4,
    tier: 6,
  },
  balanced: {
    reasoning: 26,
    tool_call: 12,
    not_fast: 6,
    context: 200000,
    variant: 3,
    multimodal: 4,
    tier: 6,
    cost_penalty: 8,
  },
  fast: { fast: 32, tool_call: 10, reasoning: 6, cost_1: 10, cost_03: 4 },
} as const;

export class ModelScorer {
  readonly catalog = new Map<string, ProviderModel>();
  readonly providers = new Map<string, string[]>();

  constructor(config: OpenCodeConfig) {
    for (const [provider, providerConfig] of Object.entries(
      config.providers ?? {},
    )) {
      const ids: string[] = [];
      for (const [modelId, meta] of Object.entries(
        providerConfig.models ?? {},
      )) {
        const fullId = `${provider}/${modelId}`;
        this.catalog.set(fullId, meta);
        ids.push(fullId);
      }
      this.providers.set(provider, ids);
    }
  }

  variants(model: string): string[] {
    const variants = this.catalog.get(model)?.variants;
    if (!Array.isArray(variants)) return [];
    return variants.flatMap((variant) => {
      if (!isRecord(variant)) return [];
      const id = typeof variant.id === "string" ? variant.id : undefined;
      return id ? [id] : [];
    });
  }

  score(model: string, role: Role): number {
    const meta = this.catalog.get(model);
    const rawCost = meta?.cost?.input;
    const baseCost = typeof rawCost === "number" ? rawCost : undefined;
    let fast = baseCost !== undefined && baseCost <= 1.5;
    if (!fast) {
      const rawFamily = meta?.family;
      const family =
        typeof rawFamily === "string" ? rawFamily.toLowerCase() : undefined;
      const familyName =
        family && family !== "unknown" ? family : scoreModelAuto(model).family;
      const lower = model.toLowerCase();
      fast = ["mini", "nano", "flash", "haiku", "spark"].some(
        (keyword) => familyName.includes(keyword) || lower.includes(keyword),
      );
    }
    if (role === "fast") {
      const weights = ROLE_WEIGHTS.fast;
      let score = 0;
      if (meta?.variants?.length) score += weights.reasoning;
      if (meta?.capabilities?.tools) score += weights.tool_call;
      if (fast) score += weights.fast;
      const cost = baseCost ?? Number.POSITIVE_INFINITY;
      if (cost <= 1) score += weights.cost_1;
      if (cost <= 0.3) score += weights.cost_03;
      return score;
    }
    const weights = ROLE_WEIGHTS[role];
    let score = 0;
    if (meta?.variants?.length) score += weights.reasoning;
    if (meta?.capabilities?.tools) score += weights.tool_call;
    if (!fast) score += weights.not_fast;
    const context = meta?.limit?.context;
    score += Math.min(
      Math.floor((typeof context === "number" ? context : 0) / weights.context),
      role === "strong" ? 12 : 8,
    );
    score += this.variants(model).length * weights.variant;
    const input = meta?.capabilities?.input;
    if (
      Array.isArray(input) &&
      input.some((value) => ["image", "pdf", "audio", "video"].includes(value))
    ) {
      score += weights.multimodal;
    }
    const tier = scoreModelAuto(model).tier;
    if (tier === "flagship" || (role === "balanced" && tier === "balanced"))
      score += weights.tier;
    if (role === "balanced")
      score -= Math.min(
        Math.trunc(baseCost ?? Number.POSITIVE_INFINITY),
        ROLE_WEIGHTS.balanced.cost_penalty,
      );
    return score;
  }
}

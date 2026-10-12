import { log } from "../config/log.ts";
import type { OpenCodeConfig } from "../config/types.ts";
import {
  formatDisplayName,
  formatReference,
  parseReference,
} from "../model/display.ts";
import { ModelScorer, type Role } from "../model/score.ts";

export type Zone = "high" | "medium" | "low";
type Effort = Zone | "none";

interface ModelSelection {
  model: string;
  variant?: string;
}

interface ModelAssignment {
  level: Zone;
  models: string[];
  variantOverrides?: Record<string, string>;
}

interface AgentPatch {
  model: string;
  variant?: string;
}

const VARIANT_STRENGTH = new Map(
  ["minimal", "low", "medium", "high", "xhigh", "max"].map((name, index) => [
    name,
    index,
  ]),
);

export const AGENTS = {
  build: { zone: "high", role: "strong" },
  plan: { zone: "high", role: "strong" },
  general: { zone: "medium", role: "balanced" },
  explore: { zone: "low", role: "fast" },
  librarian: { zone: "low", role: "fast" },
  oracle: { zone: "high", role: "strong" },
} as const satisfies Record<string, { zone: Zone; role: Role }>;
export type AgentName = keyof typeof AGENTS;

const MODEL_ZONES = [
  "high",
  "medium",
  "low",
] as const satisfies readonly Zone[];
const ZONE_FALLBACK: Record<Zone, readonly Zone[]> = {
  high: ["high", "medium", "low"],
  medium: ["medium", "low", "high"],
  low: ["low", "medium", "high"],
};

export class AgentAssigner {
  readonly scorer: ModelScorer;

  constructor(readonly config: OpenCodeConfig) {
    this.scorer = new ModelScorer(config);
  }

  private resolveVariant(
    names: readonly string[],
    level: Effort,
  ): string | undefined {
    if (level === "none")
      return names.find(
        (name) => name === "none" || name === "off" || name === "disabled",
      );
    if (names.includes(level)) return level;
    const target = VARIANT_STRENGTH.get(level);
    if (target === undefined) return undefined;
    const candidates = names.flatMap((name): [number, string][] => {
      const strength = VARIANT_STRENGTH.get(name);
      return strength === undefined ? [] : [[strength, name]];
    });
    if (!candidates.length) return undefined;
    const [, best] = candidates.reduce(
      ([bestStrength, bestName], [strength, name]) =>
        Math.abs(strength - target) < Math.abs(bestStrength - target)
          ? [strength, name]
          : [bestStrength, bestName],
    );
    return best;
  }

  private buildZonePool(
    assignments: readonly ModelAssignment[],
  ): Record<Zone, ModelSelection[]> {
    const selection: Record<Zone, ModelSelection[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const assignment of assignments) {
      selection[assignment.level] = assignment.models.map((model) => {
        const variant = assignment.variantOverrides?.[model];
        return variant ? { model, variant } : { model };
      });
    }
    const pools: Record<Zone, ModelSelection[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const zone of MODEL_ZONES) {
      const source = ZONE_FALLBACK[zone].find(
        (candidate) => selection[candidate].length,
      );
      if (!source) continue;
      pools[zone] = [...selection[source]];
      if (source !== zone)
        log.warn(
          `${zone} zone empty - borrowing ${selection[source].length} models from ${source} zone`,
        );
    }
    return pools;
  }

  buildAgentPatch(
    assignments: readonly ModelAssignment[],
    zonePool = this.buildZonePool(assignments),
  ): Record<string, AgentPatch> {
    const entries: Record<string, AgentPatch> = {};
    const names = (Object.keys(AGENTS) as AgentName[]).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const name of names) {
      const { zone, role } = AGENTS[name];
      const seen = new Set<string>();
      const candidates: ModelSelection[] = [];
      for (const candidateZone of ZONE_FALLBACK[zone]) {
        for (const candidate of zonePool[candidateZone]) {
          if (seen.has(candidate.model)) continue;
          seen.add(candidate.model);
          candidates.push(candidate);
        }
      }
      const best = candidates
        .map((candidate) => ({
          ...candidate,
          score: this.scorer.score(candidate.model, role),
        }))
        .toSorted((left, right) => right.score - left.score)[0];
      if (!best) continue;
      const variants = this.scorer.variants(best.model);
      const variant =
        best.variant && variants.includes(best.variant)
          ? best.variant
          : this.resolveVariant(variants, zone);
      entries[name] = { model: best.model, ...(variant ? { variant } : {}) };
    }
    return entries;
  }

  autoAssign(
    models: readonly string[],
    variantOverrides: Readonly<Record<string, string>> = {},
  ): ModelAssignment[] {
    const ranked = [...new Set(models)]
      .map((model) => ({ model, score: this.scorer.score(model, "strong") }))
      .toSorted((left, right) => right.score - left.score)
      .map(({ model }) => model);
    const third = Math.ceil(ranked.length / 3);
    const zones: Record<Zone, string[]> = {
      high: ranked.slice(0, third),
      medium: ranked.slice(third, third * 2),
      low: ranked.slice(third * 2),
    };
    const assignments: ModelAssignment[] = [];
    for (const level of MODEL_ZONES) {
      const pool = zones[level];
      if (!pool.length) continue;
      const presets: Record<string, string> = {};
      for (const model of pool) {
        const preset =
          variantOverrides[model] ??
          this.resolveVariant(this.scorer.variants(model), level);
        if (preset) presets[model] = preset;
      }
      assignments.push({
        level,
        models: pool,
        ...(Object.keys(presets).length ? { variantOverrides: presets } : {}),
      });
    }
    return assignments;
  }

  private setAgentModel(
    name: string,
    model: string,
    variant: string | undefined,
  ): void {
    const agents = (this.config.agents ??= {});
    const entry = agents[name] ?? {};
    agents[name] = entry;
    entry.model = formatReference(model, variant);
    delete entry.variant;
    log.ok(
      `  ${name} -> ${formatDisplayName(model)}${variant ? `#${variant}` : ""}`,
    );
  }

  applyExplicit(
    entries: Readonly<
      Record<string, { model: string; variant?: string | undefined }>
    >,
  ): void {
    for (const [name, { model, variant }] of Object.entries(entries)) {
      this.setAgentModel(name, model, variant);
    }
  }

  currentAssignments(): Array<{
    agent: string;
    model: string | undefined;
    variant: string | undefined;
  }> {
    return (Object.keys(AGENTS) as AgentName[])
      .sort((left, right) => left.localeCompare(right))
      .map((agent) => {
        const { model, variant } = parseReference(
          this.config.agents?.[agent]?.model ?? "",
        );
        return { agent, model: model || undefined, variant };
      });
  }

  apply(assignments: readonly ModelAssignment[]): void {
    const zonePool = this.buildZonePool(assignments);
    const agentPatch = this.buildAgentPatch(assignments, zonePool);
    for (const [name, patch] of Object.entries(agentPatch)) {
      this.setAgentModel(name, patch.model, patch.variant);
    }
    const buildModel = agentPatch.build?.model;
    if (buildModel) {
      this.config.model = buildModel;
      this.config.default_agent = "build";
      log.ok(`default model -> ${formatDisplayName(buildModel)}`);
      log.ok("default agent -> build");
    }
    const lowModel = zonePool.low[0]?.model;
    if (lowModel) this.setAgentModel("title", lowModel, undefined);
  }
}

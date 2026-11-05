import { maxBy, minBy, uniqBy } from "es-toolkit/array"
import { log } from "../config/log.ts"
import type { OpenCodeConfig } from "../config/schema.ts"
import { formatDisplayName, parseReference } from "../model/display.ts"
import { ModelScorer, type Role } from "../model/score.ts"

type Zone = "high" | "medium" | "low"
type Effort = Zone | "none"

export interface AgentPatch {
  model: string
  variant?: string | undefined
}

interface ModelAssignment {
  level: Zone
  models: string[]
  variantOverrides?: Record<string, string>
}

const VARIANT_STRENGTH = new Map(
  ["minimal", "low", "medium", "high", "xhigh", "max"].map((name, index) => [name, index]),
)

export const AGENTS = {
  build: { zone: "high", role: "strong" },
  plan: { zone: "high", role: "strong" },
  general: { zone: "medium", role: "balanced" },
  explore: { zone: "low", role: "fast" },
  librarian: { zone: "low", role: "fast" },
  oracle: { zone: "high", role: "strong" },
} as const satisfies Record<string, { zone: Zone; role: Role }>

const ZONE_FALLBACK: Record<Zone, readonly Zone[]> = {
  high: ["high", "medium", "low"],
  medium: ["medium", "low", "high"],
  low: ["low", "medium", "high"],
}

export class AgentAssigner {
  readonly scorer: ModelScorer

  constructor(readonly config: OpenCodeConfig) {
    this.scorer = new ModelScorer(config)
  }

  private resolveVariant(names: readonly string[], level: Effort) {
    if (level === "none") return names.find((name) => ["none", "off", "disabled"].includes(name))
    if (names.includes(level)) return level
    const target = VARIANT_STRENGTH.get(level)
    if (target === undefined) return undefined
    return minBy(
      names.filter((name) => VARIANT_STRENGTH.has(name)),
      (name) => {
        const strength = VARIANT_STRENGTH.get(name)
        return strength === undefined ? Number.POSITIVE_INFINITY : Math.abs(strength - target)
      },
    )
  }

  private buildZonePool(assignments: readonly ModelAssignment[]) {
    const selection: Record<Zone, AgentPatch[]> = { high: [], medium: [], low: [] }
    for (const assignment of assignments)
      selection[assignment.level] = assignment.models.map((model) => {
        const variant = assignment.variantOverrides?.[model]
        return variant ? { model, variant } : { model }
      })
    const pools: Record<Zone, AgentPatch[]> = { high: [], medium: [], low: [] }
    for (const zone of ["high", "medium", "low"] as const) {
      const source = ZONE_FALLBACK[zone].find((candidate) => selection[candidate].length)
      if (!source) continue
      pools[zone] = selection[source]
      if (source !== zone)
        log.warn(`${zone} zone empty - borrowing ${selection[source].length} models from ${source} zone`)
    }
    return pools
  }

  buildAgentPatch(assignments: readonly ModelAssignment[], zonePool = this.buildZonePool(assignments)) {
    const entries: Record<string, AgentPatch> = {}
    for (const [name, { zone, role }] of Object.entries(AGENTS).toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const candidates = uniqBy(
        ZONE_FALLBACK[zone].flatMap((candidateZone) => zonePool[candidateZone]),
        ({ model }) => model,
      )
      const best = maxBy(candidates, ({ model }) => this.scorer.score(model, role))
      if (!best) continue
      const variants = this.scorer.variants(best.model)
      const variant =
        best.variant && variants.includes(best.variant) ? best.variant : this.resolveVariant(variants, zone)
      entries[name] = { model: best.model, ...(variant ? { variant } : {}) }
    }
    return entries
  }

  autoAssign(models: readonly string[], variantOverrides: Readonly<Record<string, string>> = {}) {
    const ranked = [...new Set(models)]
      .map((model) => {
        return { model, score: this.scorer.score(model, "strong") }
      })
      .toSorted((left, right) => right.score - left.score)
      .map(({ model }) => model)
    const third = Math.ceil(ranked.length / 3)
    const zones = {
      high: ranked.slice(0, third),
      medium: ranked.slice(third, third * 2),
      low: ranked.slice(third * 2),
    }
    const assignments: ModelAssignment[] = []
    for (const level of ["high", "medium", "low"] as const) {
      const pool = zones[level]
      if (!pool.length) continue
      const presets: Record<string, string> = {}
      for (const model of pool) {
        const preset = variantOverrides[model] ?? this.resolveVariant(this.scorer.variants(model), level)
        if (preset) presets[model] = preset
      }
      assignments.push({
        level,
        models: pool,
        ...(Object.keys(presets).length ? { variantOverrides: presets } : {}),
      })
    }
    return assignments
  }

  private setAgentModel(name: string, model: string, variant: string | undefined) {
    const agents = this.config.agents ?? {}
    this.config.agents = agents
    const entry = agents[name] ?? {}
    agents[name] = entry
    entry.model = variant ? `${model}#${variant}` : model
    delete entry["variant"]
    log.ok(`  ${name} -> ${formatDisplayName(model)}${variant ? `#${variant}` : ""}`)
  }

  applyExplicit(entries: Readonly<Record<string, AgentPatch>>) {
    for (const [name, { model, variant }] of Object.entries(entries)) this.setAgentModel(name, model, variant)
  }

  currentAssignments() {
    return Object.keys(AGENTS)
      .toSorted((left, right) => left.localeCompare(right))
      .map((agent) => {
        const { model, variant } = parseReference(this.config.agents?.[agent]?.model ?? "")
        return { agent, model: model || undefined, variant }
      })
  }

  apply(assignments: readonly ModelAssignment[]) {
    const zonePool = this.buildZonePool(assignments)
    const agentPatch = this.buildAgentPatch(assignments, zonePool)
    this.applyExplicit(agentPatch)
    const buildModel = agentPatch["build"]?.model
    if (buildModel) {
      this.config.model = buildModel
      this.config.default_agent = "build"
      log.ok(`default model -> ${formatDisplayName(buildModel)}, default agent -> build`)
    }
    const lowModel = zonePool.low[0]?.model
    if (lowModel) this.setAgentModel("title", lowModel, undefined)
  }
}

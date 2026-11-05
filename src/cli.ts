import { parseArgs as parseNodeArgs } from "node:util"
import { AgentAssigner } from "./agent/assign.ts"
import { defaultConfigPath, loadConfig, saveConfig } from "./config/io.ts"
import { fail, log } from "./config/log.ts"
import { formatDisplayName, parseReference } from "./model/display.ts"
import { FORMAT_KEYS } from "./provider/formats.ts"
import { ModelSync } from "./provider/sync.ts"

import { parsePositiveInteger, splitList } from "./utils/input.ts"

async function main(): Promise<void> {
  const {
    values: flags,
    positionals: [command = "", ...positional],
  } = parseNodeArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      config: { type: "string" },
      format: { type: "string" },
      "base-url": { type: "string" },
      "api-key": { type: "string" },
      models: { type: "string" },
      context: { type: "string" },
      providers: { type: "string" },
      variant: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
    },
  })
  const configPath = flags.config || defaultConfigPath()
  if (flags.help === true || !command) {
    console.log(`Usage: bun run cli <command> [options]

Provider commands:
  add <name> --format <key> [--base-url <url>] [--api-key <key>] [--models <a,b,...>] [--context <tokens>]
      add a provider from an API endpoint (all discovered models by default)
  sync [<name>...] [--models <a,b,...>] [--context <tokens>]
      re-sync API model lists (all providers when no name given)
      --context applies to all selected models
  remove <name>
      remove a provider from the config
  list
      list configured providers

Agent assignment:
  assign auto [--providers <a,b,...>] [--variant <model>=<level>...] [--dry-run]
      score candidates, auto-zone them and assign agents
  assign set <agent>=<provider/model[#variant]>... [--dry-run]
      explicitly set agent models
  assign show
      print current agent assignments

Options:
  --config <path>   config file (default: ${defaultConfigPath()})
  --help, -h        show this help`)
    return
  }
  if (command === "add") {
    const name = positional[0]
    if (!name) throw new TypeError("add requires a provider name")
    const format = FORMAT_KEYS.find((key) => key === flags.format)
    if (!format) throw new TypeError(`missing or unknown --format: ${flags.format} (valid: ${FORMAT_KEYS.join(", ")})`)
    await new ModelSync(configPath).addProvider(
      name,
      format,
      { baseURL: flags["base-url"] || undefined, apiKey: flags["api-key"] || undefined },
      splitList(flags.models),
      parsePositiveInteger(flags.context, "--context"),
    )
  } else if (command === "sync") {
    await new ModelSync(configPath).syncProviders(
      positional,
      splitList(flags.models),
      parsePositiveInteger(flags.context, "--context"),
    )
  } else if (command === "remove") {
    const name = positional[0]
    if (!name) throw new TypeError("remove requires a provider name")
    new ModelSync(configPath).deleteProvider(name)
  } else if (command === "list") {
    const providers = new ModelSync(configPath).listProviders()
    if (!providers.length) log.warn("no providers configured")
    for (const provider of providers) log.info(`  ${provider.name} [${provider.format}] ${provider.models} models`)
  } else if (command === "assign") {
    const subcommand = positional.shift()
    if (subcommand === "auto") {
      const dryRun = flags["dry-run"] === true
      const config = loadConfig(configPath)
      const assigner = new AgentAssigner(config)
      const models = (splitList(flags.providers) ?? [...assigner.scorer.providers.keys()]).flatMap(
        (name) => assigner.scorer.providers.get(name) ?? [],
      )
      if (!models.length) throw new TypeError("no models found for selection")
      const overrides: Record<string, string> = {}
      for (const value of flags.variant ?? []) {
        const [model, variant] = value.split("=")
        if (!(model && variant)) throw new TypeError(`--variant expects <model>=<level>, got: ${value}`)
        overrides[model] = variant
      }
      const assignments = assigner.autoAssign(models, overrides)
      const patch = assigner.buildAgentPatch(assignments)
      log.header(dryRun ? "assign auto (dry run)" : "assign auto")
      for (const [agent, entry] of Object.entries(patch))
        log.info(`  ${agent} -> ${formatDisplayName(entry.model)}${entry.variant ? `#${entry.variant}` : ""}`)
      if (dryRun) log.warn("dry run: nothing saved")
      else {
        assigner.apply(assignments)
        saveConfig(configPath, config)
      }
    } else if (subcommand === "set") {
      const dryRun = flags["dry-run"] === true
      const config = loadConfig(configPath)
      const assigner = new AgentAssigner(config)
      const patch: Record<string, { model: string; variant?: string | undefined }> = {}
      for (const entry of positional) {
        const [agent, reference] = entry.split("=")
        if (!(agent && reference?.includes("/")))
          throw new TypeError(`expected <agent>=<provider/model[#variant]>, got: ${entry}`)
        patch[agent] = parseReference(reference)
      }
      log.header(dryRun ? "assign set (dry run)" : "assign set")
      for (const [agent, { model, variant }] of Object.entries(patch))
        log.info(`  ${agent} -> ${formatDisplayName(model)}${variant ? `#${variant}` : ""}`)
      if (dryRun) log.warn("dry run: nothing saved")
      else {
        assigner.applyExplicit(patch)
        saveConfig(configPath, config)
      }
    } else if (subcommand === "show") {
      const assigner = new AgentAssigner(loadConfig(configPath))
      for (const { agent, model, variant } of assigner.currentAssignments())
        log.info(`  ${agent} -> ${model ? `${formatDisplayName(model)}${variant ? `#${variant}` : ""}` : "(unset)"}`)
    } else throw new TypeError(`unknown assign subcommand: ${subcommand}`)
  } else throw new TypeError(`unknown command: ${command}`)
}

try {
  await main()
} catch (error) {
  fail(error)
}

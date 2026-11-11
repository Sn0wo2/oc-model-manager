import { parseArgs } from "node:util"
import { defaultConfigPath } from "./config/io.ts"
import { FORMAT_KEYS, parseFormat } from "./provider/formats.ts"
import { ModelSync } from "./provider/sync.ts"
import { parsePositiveInteger, splitList } from "./utils/input.ts"
import { log } from "./utils/log.ts"

async function main() {
  const {
    values: flags,
    positionals: [command = "", ...positional],
  } = parseArgs({
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
    },
  })
  const configPath = flags.config || defaultConfigPath()
  if (flags.help === true || !command) {
    console.log(`Usage: bun run cli <command> [options]

  add <name> --format <key> [--base-url <url>] [--api-key <key>] [--models <a,b,...>] [--context <tokens>]
      add a provider from an API endpoint (all discovered models by default)
  edit <name> [--format <key>] [--base-url <url>] [--api-key <key>]
      update provider settings without changing models (empty value clears a setting)
  sync [<name>...] [--models <a,b,...>] [--context <tokens>]
      re-sync API model lists (all providers when no name given)
      --context applies to all selected models
  remove <name>
      remove a provider from the config
  list
      list configured providers

Options:
  --config <path>   config file (default: ${defaultConfigPath()})
  --help, -h        show this help`)
    return
  }
  if (command === "add") {
    const name = positional[0]
    if (!name) throw new TypeError("add requires a provider name")
    const format = parseFormat(flags.format)
    if (!format) throw new TypeError(`add requires --format (${FORMAT_KEYS.join(", ")})`)
    await new ModelSync(configPath).addProvider(
      name,
      format,
      { baseURL: flags["base-url"] || undefined, apiKey: flags["api-key"] || undefined },
      splitList(flags.models),
      parsePositiveInteger(flags.context, "--context"),
    )
  } else if (command === "edit") {
    const name = positional[0]
    if (!name) throw new TypeError("edit requires a provider name")
    new ModelSync(configPath).editProvider(name, {
      format: parseFormat(flags.format),
      baseURL: flags["base-url"],
      apiKey: flags["api-key"],
    })
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
    for (const provider of providers) log.info(`  ${provider.name} [${provider.package}] ${provider.models} models`)
  } else throw new TypeError(`unknown command: ${command}`)
}

try {
  await main()
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

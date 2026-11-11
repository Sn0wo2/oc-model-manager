import { parseArgs } from "node:util"
import { input, password } from "@inquirer/prompts"
import { defaultConfigPath } from "./config/io.ts"
import { sortedByName } from "./model/display.ts"
import { FORMAT_KEYS, parsePackage, SDK_FORMATS } from "./provider/formats.ts"
import { ModelSync } from "./provider/sync.ts"
import { menu, pick } from "./utils/console.ts"
import { log } from "./utils/log.ts"

const { values: flags } = parseArgs({
  args: Bun.argv.slice(2),
  options: { config: { type: "string" } },
})
const configPath = flags.config || defaultConfigPath()

async function promptGlobalContext() {
  const rawContext = await input({
    message: "context for all selected models (tokens; blank leaves unchanged):",
    validate: (value) =>
      !value.trim() ||
      (Number.isSafeInteger(Number(value)) && Number(value) > 0) ||
      "Enter a positive integer or leave blank",
  })
  return rawContext.trim() ? Number(rawContext) : undefined
}

async function editProvider() {
  const sync = new ModelSync(configPath)
  const names = sync.listProviders().map(({ name }) => name)
  if (!names.length) {
    log.warn("no providers configured")
    return
  }
  const name = names[await menu(names, "select provider")]
  if (!name) return
  const provider = sync.config.providers?.[name]
  if (!provider) return
  const { baseURL } = provider.settings ?? {}
  const currentURL = typeof baseURL === "string" ? baseURL : ""
  const currentFormat = parsePackage(provider.package) ?? "unknown"
  const format =
    FORMAT_KEYS[
      await menu(
        FORMAT_KEYS.map((key) => SDK_FORMATS[key].description),
        `select API format (current: ${currentFormat})`,
      )
    ]
  const nextURL = (
    await input({
      message: `baseURL${currentURL ? ` [${currentURL}]` : ""} (blank keeps current; - clears):`,
    })
  ).trim()
  const nextKey = (
    await password({
      message: "apiKey (blank keeps current unless format changes; - clears):",
      mask: "*",
      toggleMask: false,
    })
  ).trim()
  if (format === undefined && !nextURL && !nextKey) return
  sync.editProvider(name, {
    format,
    baseURL: nextURL === "-" ? "" : nextURL || undefined,
    apiKey: nextKey === "-" ? "" : nextKey || undefined,
  })
}

async function main() {
  if (!process.stdin.isTTY) throw new Error("interactive terminal required")
  while (true) {
    log.header("opencode config manager")
    const action = await menu(
      ["add provider", "sync providers", "remove provider", "list providers", "edit provider", "exit"],
      "select action",
      1,
    )
    switch (action) {
      case 0: {
        const format =
          FORMAT_KEYS[
            await menu(
              FORMAT_KEYS.map((key) => SDK_FORMATS[key].description),
              "select API format",
            )
          ]
        if (!format) break
        const name = (await input({ message: "provider name: " })).trim()
        if (!name) {
          log.warn("no name given, aborting")
          break
        }
        const defaultURL = SDK_FORMATS[format].baseURL
        const baseURL =
          (
            await input({
              message: `baseURL${defaultURL ? ` [${defaultURL}]` : " (optional)"}: `,
            })
          ).trim() || defaultURL
        const apiKey = (
          await password({
            message: "apiKey (optional): ",
            mask: "*",
            toggleMask: false,
          })
        ).trim()
        const sync = new ModelSync(configPath)
        const credentials = { baseURL, apiKey }
        const discovered = await sync.fetchModelIds(name, {
          package: `aisdk:${SDK_FORMATS[format].package}`,
          settings: credentials,
        })
        if (!discovered) break
        const selection = await pick(sortedByName(discovered), `select models for ${name}`)
        if (!selection.length) {
          log.warn("no models selected, aborting")
          break
        }
        const context = await promptGlobalContext()
        await sync.addProvider(name, format, credentials, selection, context)
        break
      }
      case 1: {
        const sync = new ModelSync(configPath)
        const names = sync.listProviders().map((provider) => provider.name)
        if (!names.length) {
          log.warn("no providers configured")
          break
        }
        const selected = await pick(names, "select providers to sync")
        if (!selected.length) {
          log.warn("no providers selected")
          break
        }
        let selection: string[] | undefined
        if (selected.length === 1) {
          const [name] = selected
          const provider = name ? sync.config.providers?.[name] : undefined
          if (name && provider) {
            const discovered = await sync.fetchModelIds(name, provider)
            if (discovered) {
              const picked = await pick(sortedByName(discovered), `select models for ${name}`)
              if (picked.length) selection = picked
              else {
                log.warn("no models selected, aborting")
                break
              }
            }
          }
        }
        const context = await promptGlobalContext()
        await sync.syncProviders(selected, selection, context)
        break
      }
      case 2: {
        const sync = new ModelSync(configPath)
        const names = sync.listProviders().map((provider) => provider.name)
        if (!names.length) {
          log.warn("no providers configured")
          break
        }
        const name = names[await menu(names, "select provider to delete")]
        if (name) sync.deleteProvider(name)
        break
      }
      case 3:
        for (const provider of new ModelSync(configPath).listProviders())
          log.info(`  ${provider.name} [${provider.package}] ${provider.models} models`)
        break
      case 4:
        await editProvider()
        break
      default:
        return
    }
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof Error && error.name === "ExitPromptError") process.exit(0)
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

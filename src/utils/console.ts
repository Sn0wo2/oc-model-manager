import { checkbox, input, select } from "@inquirer/prompts"
import { log } from "../config/log.ts"

const ARG_WITH_SPACES_OR_EQUALS = /[\s=]/

export async function menu(items: readonly string[], label = "select", defaultIndex = 0, zeroLabel?: string) {
  if (!(items.length || zeroLabel)) return -1
  return await select({
    message: label,
    choices: [
      ...items.map((name, value) => {
        return { name, value }
      }),
      ...(zeroLabel ? [{ name: zeroLabel, value: -1 }] : []),
    ],
    default: defaultIndex >= 0 || zeroLabel ? defaultIndex : 0,
  })
}

export async function pick(items: readonly string[], label = "select") {
  if (!items.length) return []
  return await checkbox({
    message: label,
    choices: items.map((item) => {
      return {
        name: item,
        value: item,
        checked: true,
      }
    }),
  })
}

export function announce(argv: readonly string[]) {
  log.run(
    `$ bun run cli ${argv
      .map((token, index) => {
        if (index > 0 && argv[index - 1] === "--api-key") return "***"
        if (token.startsWith("--api-key=")) return "--api-key=***"
        return ARG_WITH_SPACES_OR_EQUALS.test(token) ? `"${token}"` : token
      })
      .join(" ")}`,
  )
}

export async function promptGlobalContext() {
  const rawContext = await input({
    message: "context for all selected models (tokens; blank leaves unchanged):",
    validate: (value) =>
      !value.trim() ||
      (Number.isSafeInteger(Number(value)) && Number(value) > 0) ||
      "Enter a positive integer or leave blank",
  })
  return rawContext.trim() ? Number(rawContext) : undefined
}

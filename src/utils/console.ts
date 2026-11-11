import { styleText } from "node:util"
import { checkbox, select } from "@inquirer/prompts"

const keysHelpTip = (keys: [string, string][]) =>
  [...keys, ["esc", "back"] as const]
    .map(([key, action]) => `${styleText("bold", key)} ${styleText("dim", action)}`)
    .join(styleText("dim", " • "))

async function abortable<T>(prompt: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController()
  const onKeypress = (_input: string, key: { name?: string }) => {
    if (key.name === "escape") controller.abort()
  }
  process.stdin.on("keypress", onKeypress)
  try {
    return await prompt(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) return
    throw error
  } finally {
    process.stdin.off("keypress", onKeypress)
  }
}

export async function menu(items: readonly string[], label = "select", defaultIndex = 0) {
  if (!items.length) return -1
  return (
    (await abortable((signal) =>
      select(
        {
          message: label,
          choices: items.map((name, value) => {
            return { name, value }
          }),
          default: defaultIndex,
          theme: { style: { keysHelpTip } },
        },
        { signal },
      ),
    )) ?? -1
  )
}

export async function pick(items: readonly string[], label = "select") {
  if (!items.length) return []
  return (
    (await abortable((signal) =>
      checkbox(
        {
          message: label,
          choices: items.map((item) => {
            return { name: item, value: item, checked: true }
          }),
          theme: { style: { keysHelpTip } },
        },
        { signal },
      ),
    )) ?? []
  )
}

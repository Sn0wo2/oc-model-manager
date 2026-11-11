import { compact } from "es-toolkit/array"

export function splitList(value?: string) {
  const items = compact(value?.split(",").map((item) => item.trim()) ?? [])
  return items.length ? items : undefined
}

export function parsePositiveInteger(value: string | undefined, option: string) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${option} must be a positive integer`)
  return number
}

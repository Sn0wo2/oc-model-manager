import { compact } from "es-toolkit/array"
import { memoize } from "es-toolkit/function"
import { upperFirst } from "es-toolkit/string"

const BRAND_NAMES: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
}
const BRAND_SEPARATOR = /[-_]/g
const ACRONYM_PATTERN = /^(?:api|ai|gpt|glm|llm|sdk|url|mcp)$/
const STARTS_WITH_DIGIT = /^\d/
const HAS_UPPERCASE_AFTER_FIRST = /[A-Z]/
const HAS_LOWERCASE = /[a-z]/
const collator = new Intl.Collator(undefined, { sensitivity: "base" })

export const formatDisplayName = memoize((rawId: string) =>
  rawId
    .split("/")
    .map(
      (segment) =>
        BRAND_NAMES[segment.toLowerCase().replaceAll(BRAND_SEPARATOR, "")] ??
        compact(segment.split(BRAND_SEPARATOR))
          .map((word) => {
            const lower = word.toLowerCase()
            if (BRAND_NAMES[lower]) return BRAND_NAMES[lower]
            if (ACRONYM_PATTERN.test(lower)) return word.toUpperCase()
            if (
              STARTS_WITH_DIGIT.test(word) ||
              (word.length >= 2 && word === word.toUpperCase()) ||
              (HAS_UPPERCASE_AFTER_FIRST.test(word.slice(1)) && HAS_LOWERCASE.test(word))
            )
              return word
            return upperFirst(word)
          })
          .join("-"),
    )
    .join(" "),
)

export function sortedByName(items: Iterable<string>): string[] {
  return [...items].sort((left, right) => collator.compare(formatDisplayName(left), formatDisplayName(right)))
}

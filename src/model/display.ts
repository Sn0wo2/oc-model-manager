const BRAND_NAMES: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
}
const ACRONYM_PATTERN = /^(?:api|ai|gpt|glm|llm|sdk|url|mcp)$/
const STARTS_WITH_DIGIT = /^\d/
const HAS_UPPERCASE_AFTER_FIRST = /[A-Z]/
const HAS_LOWERCASE = /[a-z]/
const displayNameCache = new Map<string, string>()

export function formatDisplayName(rawId: string): string {
  const cached = displayNameCache.get(rawId)
  if (cached !== undefined) return cached
  const displayName = rawId
    .split("/")
    .map(
      (segment) =>
        BRAND_NAMES[segment.toLowerCase().replaceAll("-", "").replaceAll("_", "")] ??
        segment
          .replaceAll("_", "-")
          .split("-")
          .filter(Boolean)
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
            return word.charAt(0).toUpperCase() + word.slice(1)
          })
          .join("-"),
    )
    .join(" ")
  displayNameCache.set(rawId, displayName)
  return displayName
}

export function sortedByName(items: Iterable<string>): string[] {
  return [...items].sort((left, right) =>
    formatDisplayName(left).localeCompare(formatDisplayName(right), undefined, {
      sensitivity: "base",
    }),
  )
}

export function parseReference(ref: string) {
  const [model, variant] = ref.split("#")
  return { model: model ?? "", variant: variant || undefined }
}

const BRAND_NAMES: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
};
const displayNameCache = new Map<string, string>();

export function formatDisplayName(rawId: string): string {
  const cached = displayNameCache.get(rawId);
  if (cached !== undefined) return cached;
  const displayName = rawId
    .split("/")
    .map(
      (segment) =>
        BRAND_NAMES[
          segment.toLowerCase().replaceAll("-", "").replaceAll("_", "")
        ] ??
        segment
          .replaceAll("_", "-")
          .split("-")
          .filter(Boolean)
          .map((word) => {
            const lower = word.toLowerCase();
            if (BRAND_NAMES[lower]) return BRAND_NAMES[lower];
            if (/^(?:api|ai|gpt|glm|llm|sdk|url|mcp)$/.test(lower))
              return word.toUpperCase();
            if (
              /^\d/.test(word) ||
              (word.length >= 2 && word === word.toUpperCase()) ||
              (/[A-Z]/.test(word.slice(1)) && /[a-z]/.test(word))
            )
              return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join("-"),
    )
    .join(" ");
  displayNameCache.set(rawId, displayName);
  return displayName;
}

export function sortedByName(items: Iterable<string>): string[] {
  return [...items].sort((left, right) =>
    formatDisplayName(left).localeCompare(formatDisplayName(right), undefined, {
      sensitivity: "base",
    }),
  );
}

export function formatReference(model: string, variant?: string): string {
  return variant ? `${model}#${variant}` : model;
}

export function parseReference(ref: string): {
  model: string;
  variant: string | undefined;
} {
  const [model, variant] = ref.split("#");
  return { model: model ?? "", variant: variant || undefined };
}

export function formatDisplayReference(
  model: string,
  variant?: string,
): string {
  return formatReference(formatDisplayName(model), variant);
}

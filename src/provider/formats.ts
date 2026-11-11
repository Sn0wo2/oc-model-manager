interface SdkFormat {
  package: string
  baseURL: string
  description: string
  discovery: "api" | "catalog"
}

function sdkFormat(
  packageName: string,
  description: string,
  overrides: { baseURL?: string; discovery?: "api" | "catalog" } = {},
): SdkFormat {
  return {
    package: packageName,
    baseURL: "",
    description,
    discovery: "catalog",
    ...overrides,
  }
}

export const SDK_FORMATS = {
  openai: sdkFormat("@ai-sdk/openai-compatible", "OpenAI Compatible API", {
    discovery: "api",
  }),
  responses: sdkFormat("@ai-sdk/openai", "OpenAI Official API", {
    baseURL: "https://api.openai.com/v1",
    discovery: "api",
  }),
  anthropic: sdkFormat("@ai-sdk/anthropic", "Anthropic Claude API", {
    baseURL: "https://api.anthropic.com/v1",
    discovery: "api",
  }),
  gemini: sdkFormat("@ai-sdk/google", "Gemini API", {
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    discovery: "api",
  }),
  azure: sdkFormat("@ai-sdk/azure", "Azure OpenAI"),
  bedrock: sdkFormat("@ai-sdk/amazon-bedrock", "Amazon Bedrock"),
  vertex: sdkFormat("@ai-sdk/google-vertex", "Google Vertex AI"),
  vertexAnthropic: sdkFormat("@ai-sdk/google-vertex/anthropic", "Anthropic on Google Vertex AI"),
  xai: sdkFormat("@ai-sdk/xai", "xAI Grok"),
  mistral: sdkFormat("@ai-sdk/mistral", "Mistral AI"),
  groq: sdkFormat("@ai-sdk/groq", "Groq"),
  cohere: sdkFormat("@ai-sdk/cohere", "Cohere"),
  openrouter: sdkFormat("@openrouter/ai-sdk-provider", "OpenRouter"),
  deepinfra: sdkFormat("@ai-sdk/deepinfra", "DeepInfra"),
  cerebras: sdkFormat("@ai-sdk/cerebras", "Cerebras"),
  togetherai: sdkFormat("@ai-sdk/togetherai", "Together AI"),
  perplexity: sdkFormat("@ai-sdk/perplexity", "Perplexity"),
  gateway: sdkFormat("@ai-sdk/gateway", "Vercel AI Gateway"),
  vercel: sdkFormat("@ai-sdk/vercel", "Vercel v0"),
} satisfies Record<string, SdkFormat>

export type FormatKey = keyof typeof SDK_FORMATS

export const FORMAT_KEYS = Object.keys(SDK_FORMATS) as FormatKey[]

const AISDK_PREFIX = /^aisdk:/

export function parsePackage(value: string | undefined) {
  return value?.replace(AISDK_PREFIX, "")
}

export function parseFormat(value?: string) {
  if (value === undefined) return
  const format = FORMAT_KEYS.find((key) => key === value)
  if (!format) throw new TypeError(`unknown --format: ${value} (valid: ${FORMAT_KEYS.join(", ")})`)
  return format
}

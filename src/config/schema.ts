import { z } from "zod"

const providerModelSchema = z.looseObject({
  family: z.string().optional(),
  cost: z.looseObject({ input: z.number().optional() }).optional(),
  limit: z.looseObject({ context: z.number().optional() }).optional(),
  capabilities: z.looseObject({ tools: z.boolean().optional(), input: z.array(z.string()).optional() }).optional(),
  variants: z.array(z.looseObject({ id: z.string() })).optional(),
})

const providerConfigSchema = z.looseObject({
  package: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  models: z.record(z.string(), providerModelSchema).optional(),
})

export const openCodeConfigSchema = z.looseObject({
  model: z.string().optional(),
  default_agent: z.string().optional(),
  agents: z.record(z.string(), z.looseObject({ model: z.string().optional(), mode: z.string().optional() })).optional(),
  providers: z.record(z.string(), providerConfigSchema).optional(),
})

export type OpenCodeConfig = z.infer<typeof openCodeConfigSchema>
export type ProviderConfig = z.infer<typeof providerConfigSchema>
export type ProviderModel = z.infer<typeof providerModelSchema>

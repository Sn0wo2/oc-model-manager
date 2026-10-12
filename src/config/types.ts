export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface CostConfig {
  input: number;
  output: number;
  cache?: { read?: number; write?: number };
  context_over_200k?: CostConfig;
}

export interface ProviderModel {
  modelID?: string;
  name?: string;
  family?: string;
  cost?: CostConfig;
  limit?: { context?: number; input?: number; output?: number };
  capabilities?: { tools?: boolean; input?: string[]; output?: string[] };
  compatibility?: { reasoningField?: string };
  settings?: JsonObject;
  variants?: { id: string; settings?: JsonObject }[];
  disabled?: boolean;
}

export interface ProviderConfig {
  name?: string;
  env?: string[];
  id?: string;
  package?: string;
  settings?: JsonObject;
  headers?: Record<string, string>;
  body?: JsonObject;
  models?: Record<string, ProviderModel>;
}

export type OpenCodeConfig = JsonObject & {
  model?: string;
  default_agent?: string;
  agents?: Record<
    string,
    {
      model?: string;
      mode?: "primary" | "subagent" | "all";
      [key: string]: JsonValue | undefined;
    }
  >;
  providers?: Record<string, ProviderConfig>;
};

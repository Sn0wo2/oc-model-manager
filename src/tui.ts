import { parseArgs as parseNodeArgs } from "node:util";
import { confirm, input, password } from "@inquirer/prompts";
import { defaultConfigPath, loadConfig, saveConfig } from "./config/io.ts";
import { fail, log } from "./config/log.ts";
import {
  formatDisplayReference,
  formatDisplayName,
  formatReference,
  sortedByName,
} from "./model/display.ts";
import {
  FORMAT_KEYS,
  packageForFormat,
  SDK_FORMATS,
} from "./provider/formats.ts";
import { ModelSync } from "./provider/sync.ts";
import { AGENTS, AgentAssigner } from "./agent/assign.ts";
import { announce, menu, pick, promptGlobalContext } from "./utils/console.ts";

const { values: flags } = parseNodeArgs({
  args: Bun.argv.slice(2),
  options: { config: { type: "string" } },
});
const configPath = flags.config || defaultConfigPath();

async function main(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("interactive terminal required");
  while (true) {
    log.header("opencode config manager");
    const action = await menu(
      [
        "add provider",
        "sync providers",
        "remove provider",
        "list providers",
        "assign agents (manual)",
        "show assignments",
        "exit",
      ],
      "select action",
      1,
    );
    switch (action) {
      case 0: {
        const format =
          FORMAT_KEYS[
            await menu(
              FORMAT_KEYS.map((format) => SDK_FORMATS[format].description),
              "select API format",
            )
          ];
        if (!format) break;
        const name = (await input({ message: "provider name: " })).trim();
        if (!name) {
          log.warn("no name given, aborting");
          break;
        }
        const defaultURL = SDK_FORMATS[format].baseURL;
        const baseURL =
          (
            await input({
              message: `baseURL${defaultURL ? ` [${defaultURL}]` : " (optional)"}: `,
            })
          ).trim() || defaultURL;
        const apiKey = (
          await password({
            message: "apiKey (optional): ",
            mask: "*",
            toggleMask: false,
          })
        ).trim();
        const sync = new ModelSync(configPath);
        const credentials = {
          ...(baseURL ? { baseURL } : {}),
          ...(apiKey ? { apiKey } : {}),
        };
        const discovered = await sync.fetchModelIds(name, {
          package: packageForFormat(format),
          settings: credentials as Record<string, string>,
        });
        if (!discovered) break;
        const selection = await pick(
          sortedByName(discovered),
          `select models for ${name}`,
        );
        if (!selection.length) {
          log.warn("no models selected, aborting");
          break;
        }
        const context = await promptGlobalContext();
        announce([
          "add",
          name,
          "--format",
          format,
          ...(baseURL && baseURL !== defaultURL ? ["--base-url", baseURL] : []),
          ...(apiKey ? ["--api-key", apiKey] : []),
          "--models",
          selection.join(","),
          ...(context === undefined ? [] : ["--context", String(context)]),
        ]);
        await sync.addProvider(name, format, credentials, selection, context);
        break;
      }
      case 1: {
        const sync = new ModelSync(configPath);
        const names = sync.listProviders().map((provider) => provider.name);
        if (!names.length) {
          log.warn("no providers configured");
          break;
        }
        const selected = await pick(names, "select providers to sync");
        if (!selected.length) {
          log.warn("no providers selected");
          break;
        }
        let selection: string[] | undefined;
        if (selected.length === 1) {
          const [name] = selected;
          const provider = name ? sync.config.providers?.[name] : undefined;
          if (name && provider) {
            const discovered = await sync.fetchModelIds(name, provider);
            if (discovered) {
              const picked = await pick(
                sortedByName(discovered),
                `select models for ${name}`,
              );
              if (picked.length) selection = picked;
              else {
                log.warn("no models selected, aborting");
                break;
              }
            }
          }
        }
        const context = await promptGlobalContext();
        announce([
          "sync",
          ...selected,
          ...(selection ? ["--models", selection.join(",")] : []),
          ...(context === undefined ? [] : ["--context", String(context)]),
        ]);
        await sync.syncProviders(selected, selection, context);
        break;
      }
      case 2: {
        const sync = new ModelSync(configPath);
        const names = sync.listProviders().map((provider) => provider.name);
        if (!names.length) {
          log.warn("no providers configured");
          break;
        }
        const name =
          names[await menu(names, "select provider to delete", -1, "cancel")];
        if (name) {
          announce(["remove", name]);
          sync.deleteProvider(name);
        }
        break;
      }
      case 3:
        announce(["list"]);
        for (const provider of new ModelSync(configPath).listProviders())
          log.info(
            `  ${provider.name} [${provider.format}] ${provider.models} models`,
          );
        break;
      case 4: {
        const config = loadConfig(configPath);
        const assigner = new AgentAssigner(config);
        const agents = Object.keys(AGENTS).sort((left, right) => {
          const leftSub = config.agents?.[left]?.mode === "subagent" ? 1 : 0;
          const rightSub = config.agents?.[right]?.mode === "subagent" ? 1 : 0;
          if (leftSub !== rightSub) return leftSub - rightSub;
          return formatDisplayName(left).localeCompare(
            formatDisplayName(right),
            undefined,
            { sensitivity: "base" },
          );
        });
        const selectedAgents = await pick(
          agents,
          "select agents (comma-separated)",
        );
        if (!selectedAgents.length) {
          log.warn("no agents selected");
          break;
        }
        const providerNames = sortedByName([
          ...assigner.scorer.providers.keys(),
        ]);
        const provider =
          providerNames[await menu(providerNames, "select provider")];
        if (!provider) break;
        const models = sortedByName(
          assigner.scorer.providers.get(provider) ?? [],
        );
        const model = models[await menu(models, "select model")];
        if (!model) break;
        const variants = assigner.scorer.variants(model);
        const variant = variants.length
          ? variants[await menu(variants, "thinking variant", -1, "default")]
          : undefined;
        announce([
          "assign",
          "set",
          ...selectedAgents.map(
            (agent) => `${agent}=${formatReference(model, variant)}`,
          ),
        ]);
        if (!(await confirm({ message: "apply?", default: true }))) break;
        assigner.applyExplicit(
          Object.fromEntries(
            selectedAgents.map((agent) => [
              agent,
              { model, variant: variant ?? undefined },
            ]),
          ),
        );
        saveConfig(configPath, config);
        break;
      }
      case 5:
        announce(["assign", "show"]);
        for (const { agent, model, variant } of new AgentAssigner(
          loadConfig(configPath),
        ).currentAssignments())
          log.info(
            `  ${agent} -> ${model ? formatDisplayReference(model, variant) : "(unset)"}`,
          );
        break;
      default:
        return;
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && error.name === "ExitPromptError")
    process.exit(0);
  fail(error);
}

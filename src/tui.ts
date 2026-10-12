import { parseArgs as parseNodeArgs } from "node:util";
import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
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

const consoleUi = {
  async menu(
    items: readonly string[],
    label = "select",
    defaultIndex = 0,
    zeroLabel?: string,
  ): Promise<number> {
    if (!items.length && !zeroLabel) return -1;
    return select({
      message: label,
      choices: [
        ...items.map((name, value) => ({ name, value })),
        ...(zeroLabel ? [{ name: zeroLabel, value: -1 }] : []),
      ],
      default: defaultIndex >= 0 || zeroLabel ? defaultIndex : 0,
    });
  },
  async pick(items: readonly string[], label = "select"): Promise<string[]> {
    if (!items.length) return [];
    return checkbox({
      message: label,
      choices: items.map((item) => ({
        name: item,
        value: item,
        checked: true,
      })),
    });
  },
  async input(message: string): Promise<string> {
    return (await input({ message })).trim();
  },
};

function announce(argv: readonly string[]): void {
  log.run(
    `$ bun run cli ${argv
      .map((token, index) => {
        if (index > 0 && argv[index - 1] === "--api-key") return "***";
        if (token.startsWith("--api-key=")) return "--api-key=***";
        return /[\s=]/.test(token) ? `"${token}"` : token;
      })
      .join(" ")}`,
  );
}

const { values: flags } = parseNodeArgs({
  args: Bun.argv.slice(2),
  options: { config: { type: "string" } },
});
const configPath = flags.config || defaultConfigPath();

async function main(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("interactive terminal required");
  while (true) {
    log.header("opencode config manager");
    const action = await consoleUi.menu(
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
            await consoleUi.menu(
              FORMAT_KEYS.map((format) => SDK_FORMATS[format].description),
              "select API format",
            )
          ];
        if (!format) break;
        const name = await consoleUi.input("provider name: ");
        if (!name) {
          log.warn("no name given, aborting");
          break;
        }
        const defaultURL = SDK_FORMATS[format].baseURL;
        const baseURL =
          (await consoleUi.input(
            `baseURL${defaultURL ? ` [${defaultURL}]` : " (optional)"}: `,
          )) || defaultURL;
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
        const selection = await consoleUi.pick(
          sortedByName(discovered),
          `select models for ${name}`,
        );
        if (!selection.length) {
          log.warn("no models selected, aborting");
          break;
        }
        announce([
          "add",
          name,
          "--format",
          format,
          ...(baseURL && baseURL !== defaultURL ? ["--base-url", baseURL] : []),
          ...(apiKey ? ["--api-key", apiKey] : []),
          "--models",
          selection.join(","),
        ]);
        await sync.addProvider(name, format, credentials, selection);
        break;
      }
      case 1: {
        const sync = new ModelSync(configPath);
        const names = sync.listProviders().map((provider) => provider.name);
        if (!names.length) {
          log.warn("no providers configured");
          break;
        }
        const selected = await consoleUi.pick(
          names,
          "select providers to sync",
        );
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
              const picked = await consoleUi.pick(
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
        announce([
          "sync",
          ...selected,
          ...(selection ? ["--models", selection.join(",")] : []),
        ]);
        await sync.syncProviders(selected, selection);
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
          names[
            await consoleUi.menu(
              names,
              "select provider to delete",
              -1,
              "cancel",
            )
          ];
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
        const selectedAgents = await consoleUi.pick(
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
          providerNames[await consoleUi.menu(providerNames, "select provider")];
        if (!provider) break;
        const models = sortedByName(
          assigner.scorer.providers.get(provider) ?? [],
        );
        const model = models[await consoleUi.menu(models, "select model")];
        if (!model) break;
        const variants = assigner.scorer.variants(model);
        const variant = variants.length
          ? variants[
              await consoleUi.menu(variants, "thinking variant", -1, "default")
            ]
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

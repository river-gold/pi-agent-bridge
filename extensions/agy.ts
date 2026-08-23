/**
 * Antigravity (agy) provider for pi.
 *
 * Routes prompts through the agy CLI.
 * Models: <extension-root>/models.jsonc (or PI_AGENT_BRIDGE_CONFIG).
 *
 * Install:
 *   pi install /path/to/pi-agent-bridge
 *   # or
 *   pi -e /path/to/pi-agent-bridge
 *
 * Env:
 *   AGY_BINARY            agy binary (default: agy)
 *   AGY_TIMEOUT_MS        per-turn timeout (default: 300000)
 *   AGY_EXTRA_ARGS        extra CLI args, space-separated
 *   AGY_CONVERSATIONS_DIR override conversation dir used for binding discovery
 *   PI_AGENT_BRIDGE_CONFIG  models.jsonc path override
 *
 * Security:
 *   Every agy invocation uses --dangerously-skip-permissions.
 *   Pi system prompts and tools are not forwarded; agy runs as its own agent.
 */
import {
  createProvider,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverModels } from "../src/agy/agy-models.ts";
import { loadConfig } from "../src/agy/config.ts";
import { SessionStore } from "../src/agy/session-store.ts";
import { streamAgy, type StreamRuntime } from "../src/agy/stream.ts";

export default async function (pi: ExtensionAPI) {
  const config = loadConfig();
  let cwd = process.cwd();

  const { models, meta } = await discoverModels();

  const runtime: StreamRuntime = {
    config,
    getCwd: () => cwd,
    getMeta: (modelId) => meta.get(modelId),
    store: new SessionStore(config.stateFile, config.bindingLockFile),
  };

  const stream = (
    model: Model<"agy-cli">,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => streamAgy(runtime, model, context, options);

  const register = (nextModels: Model<"agy-cli">[]) => {
    pi.registerProvider(
      createProvider({
        id: "agy",
        name: "Antigravity",
        baseUrl: "local://agy",
        auth: {
          apiKey: {
            name: "Antigravity CLI",
            resolve: async () => ({
              auth: { apiKey: "agy" },
              source: "agy CLI",
            }),
          },
        },
        models: nextModels,
        api: {
          stream,
          streamSimple: stream,
        },
      }),
    );
  };

  register(models);

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });
}

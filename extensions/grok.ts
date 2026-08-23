/**
 * Grok ACP provider for pi.
 *
 * Spawns `grok agent --always-approve stdio` and routes prompts through ACP.
 * Models: <extension-root>/models.jsonc (or PI_AGENT_BRIDGE_CONFIG).
 *
 * Install:
 *   pi install /path/to/pi-agent-bridge
 *   # or
 *   pi -e /path/to/pi-agent-bridge
 *
 * Env:
 *   GROK_ACP_COMMAND      launcher (default: grok)
 *   GROK_ACP_ARGS         args (default: agent --always-approve stdio)
 *   GROK_ACP_TIMEOUT_MS   per-turn timeout (default: 300000)
 *   PI_AGENT_BRIDGE_CONFIG models.jsonc path override
 *
 * Security:
 *   Permissions are auto-approved.
 *   Spawn uses --always-approve.
 *   Pi system prompts and tools are not forwarded.
 */
import {
  createProvider,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GrokAcpClient } from "../src/grok/client.ts";
import { loadGrokConfig } from "../src/grok/config.ts";
import { discoverModels, type GrokModelMeta } from "../src/grok/models.ts";
import { streamGrok, type GrokStreamRuntime } from "../src/grok/stream.ts";
import { SessionStore } from "../src/shared/session-store.ts";

export default async function (pi: ExtensionAPI) {
  const config = loadGrokConfig();
  let cwd = process.cwd();

  const { models, meta: initialMeta } = await discoverModels();
  let meta: Map<string, GrokModelMeta> = initialMeta;
  const client = new GrokAcpClient(config);

  const runtime: GrokStreamRuntime = {
    config,
    getCwd: () => cwd,
    getMeta: (modelId) => meta.get(modelId),
    store: new SessionStore(config.stateFile, config.bindingLockFile),
    client,
  };

  const stream = (
    model: Model<"grok-acp">,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => streamGrok(runtime, model, context, options);

  const register = (nextModels: Model<"grok-acp">[]) => {
    pi.registerProvider(
      createProvider({
        id: "grok",
        name: "Grok ACP",
        baseUrl: "local://grok-acp",
        auth: {
          apiKey: {
            name: "Grok ACP",
            resolve: async () => ({
              auth: { apiKey: "grok-acp" },
              source: "grok-acp",
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

  pi.on("session_shutdown", async () => {
    await client.dispose();
  });
}

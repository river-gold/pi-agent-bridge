/**
 * Codex ACP provider for pi.
 *
 * Spawns `npx -y @agentclientprotocol/codex-acp@1.6.0` and routes prompts
 * through the Agent Client Protocol.
 * Models: .pi/agent/pi-agent-bridge.jsonc under Pi's startup cwd, then
 * ~/.pi/agent/pi-agent-bridge.jsonc (or PI_AGENT_BRIDGE_CONFIG alone).
 *
 * Install:
 *   pi install /path/to/pi-agent-bridge
 *   # or
 *   pi -e /path/to/pi-agent-bridge
 *
 * Env:
 *   CODEX_ACP_COMMAND      launcher (default: npx)
 *   CODEX_ACP_ARGS         args (default: -y @agentclientprotocol/codex-acp@1.6.0)
 *   CODEX_ACP_TIMEOUT_MS   per-turn timeout (default: 300000)
 *   CODEX_ACP_MODE         session mode (default: agent-full-access)
 *   PI_AGENT_BRIDGE_CONFIG model config path override
 *
 * Security:
 *   Permissions are auto-approved (allow_always/allow_once).
 *   Default mode is agent-full-access.
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
import { CodexAcpClient } from "../src/codex/client.ts";
import { loadCodexConfig } from "../src/codex/config.ts";
import { discoverModels, type CodexModelMeta } from "../src/codex/models.ts";
import { streamCodex, type CodexStreamRuntime } from "../src/codex/stream.ts";
import { SessionStore } from "../src/shared/session-store.ts";

export default async function (pi: ExtensionAPI) {
  const config = loadCodexConfig();
  let cwd = process.cwd();

  const { models, meta: initialMeta } = await discoverModels();
  let meta: Map<string, CodexModelMeta> = initialMeta;
  const client = new CodexAcpClient(config);

  const runtime: CodexStreamRuntime = {
    config,
    getCwd: () => cwd,
    getMeta: (modelId) => meta.get(modelId),
    store: new SessionStore(config.stateFile, config.bindingLockFile),
    client,
  };

  const stream = (
    model: Model<"codex-acp">,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => streamCodex(runtime, model, context, options);

  const register = (nextModels: Model<"codex-acp">[]) => {
    pi.registerProvider(
      createProvider({
        id: "codex",
        name: "Codex ACP",
        baseUrl: "local://codex-acp",
        auth: {
          apiKey: {
            name: "Codex ACP",
            resolve: async () => ({
              auth: { apiKey: "codex-acp" },
              source: "codex-acp",
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

  // Best-effort cleanup when pi unloads the extension.
  pi.on("session_shutdown", async () => {
    await client.dispose();
  });
}

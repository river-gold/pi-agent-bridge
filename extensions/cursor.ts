/**
 * Cursor ACP provider for pi.
 *
 * Spawns `cursor-agent acp` and routes prompts through ACP.
 * Models: <extension-root>/models.jsonc (or PI_AGENT_BRIDGE_CONFIG).
 *
 * Env:
 *   CURSOR_ACP_COMMAND      launcher (default: cursor-agent)
 *   CURSOR_ACP_ARGS         args (default: acp)
 *   CURSOR_ACP_TIMEOUT_MS   per-turn timeout (default: 300000)
 *   CURSOR_ACP_MODE         session mode agent|plan|ask (default: agent)
 *   PI_AGENT_BRIDGE_CONFIG  models.jsonc path override
 *
 * Auth: run `cursor-agent login` first (ACP method cursor_login).
 *
 * Security:
 *   Permissions are auto-approved (allow-always preferred).
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
import { CursorAcpClient } from "../src/cursor/client.ts";
import { loadCursorConfig } from "../src/cursor/config.ts";
import { discoverModels, type CursorModelMeta } from "../src/cursor/models.ts";
import { streamCursor, type CursorStreamRuntime } from "../src/cursor/stream.ts";
import { SessionStore } from "../src/shared/session-store.ts";

export default async function (pi: ExtensionAPI) {
  const config = loadCursorConfig();
  let cwd = process.cwd();

  const { models, meta: initialMeta } = await discoverModels();
  let meta: Map<string, CursorModelMeta> = initialMeta;
  const client = new CursorAcpClient(config);

  const runtime: CursorStreamRuntime = {
    config,
    getCwd: () => cwd,
    getMeta: (modelId) => meta.get(modelId),
    store: new SessionStore(config.stateFile, config.bindingLockFile),
    client,
  };

  const stream = (
    model: Model<"cursor-acp">,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => streamCursor(runtime, model, context, options);

  const register = (nextModels: Model<"cursor-acp">[]) => {
    pi.registerProvider(
      createProvider({
        id: "cursor",
        name: "Cursor ACP",
        baseUrl: "local://cursor-acp",
        auth: {
          apiKey: {
            name: "Cursor ACP",
            resolve: async () => ({
              auth: { apiKey: "cursor-acp" },
              source: "cursor-acp",
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

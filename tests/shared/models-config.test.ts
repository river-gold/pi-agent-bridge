import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { discoverModels as discoverAgy } from "../../src/agy/agy-models.ts";
import {
  defaultModelsConfigPath,
  loadModelsConfigFile,
  type ModelsConfigFile,
  parseModelsConfig,
  resolveAgentCatalog,
  resolveModelsConfigPath,
} from "../../src/shared/models-config.ts";

const execFileAsync = promisify(execFile);
const modelsConfigModuleUrl = new URL("../../src/shared/models-config.ts", import.meta.url).href;
const relativeConfigPath = join(".pi", "agent", "pi-agent-bridge.jsonc");

type ChildLoadResult =
  | {
      ok: true;
      loaded: { path: string; config: ModelsConfigFile; exists: boolean };
    }
  | { ok: false; code?: string; message: string };

async function writeModelsConfig(baseDir: string, config: unknown): Promise<string> {
  const path = join(baseDir, relativeConfigPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config), "utf-8");
  return path;
}

async function loadModelsConfigInChild(options: {
  cwd: string;
  home: string;
  explicitPath?: string;
  envPath?: string;
}): Promise<ChildLoadResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: options.home };
  if (options.envPath === undefined) delete env.PI_AGENT_BRIDGE_CONFIG;
  else env.PI_AGENT_BRIDGE_CONFIG = options.envPath;

  const script = `
import { loadModelsConfigFile } from ${JSON.stringify(modelsConfigModuleUrl)};
try {
  const loaded = await loadModelsConfigFile(${JSON.stringify(options.explicitPath)});
  process.stdout.write(JSON.stringify({ ok: true, loaded }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error),
  }));
}
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { cwd: options.cwd, env },
  );
  return JSON.parse(stdout) as ChildLoadResult;
}

function assertLoaded(
  result: ChildLoadResult,
): asserts result is Extract<ChildLoadResult, { ok: true }> {
  expect(result.ok).toBe(true);
}

describe("models-config", () => {
  it("resolveModelsConfigPath prefers override then env then cwd default", async () => {
    const prev = process.env.PI_AGENT_BRIDGE_CONFIG;
    const prevCwd = process.cwd();
    const dir = await mkdtemp(join(tmpdir(), "pi-models-path-"));
    try {
      process.chdir(dir);
      delete process.env.PI_AGENT_BRIDGE_CONFIG;
      const cwdDefault = join(process.cwd(), ".pi", "agent", "pi-agent-bridge.jsonc");
      expect(defaultModelsConfigPath()).toBe(cwdDefault);
      expect(resolveModelsConfigPath()).toBe(cwdDefault);
      expect(resolveModelsConfigPath("/tmp/x.json")).toBe("/tmp/x.json");
      process.env.PI_AGENT_BRIDGE_CONFIG = "/tmp/env.json";
      expect(resolveModelsConfigPath()).toBe("/tmp/env.json");
      expect(resolveModelsConfigPath("/tmp/override.json")).toBe("/tmp/override.json");
    } finally {
      process.chdir(prevCwd);
      if (prev === undefined) delete process.env.PI_AGENT_BRIDGE_CONFIG;
      else process.env.PI_AGENT_BRIDGE_CONFIG = prev;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads explicit, env, project, then home without cross-file merging", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-models-default-")));
    const project = join(root, "project");
    const home = join(root, "home");
    const projectPath = join(project, relativeConfigPath);
    const homePath = join(home, relativeConfigPath);
    const envPath = join(root, "env.jsonc");
    const explicitPath = join(root, "explicit.jsonc");
    await mkdir(project, { recursive: true });
    try {
      await writeModelsConfig(project, { agy: { models: { project: {} } } });
      await writeModelsConfig(home, { agy: { models: { home: {} } } });
      await writeFile(envPath, JSON.stringify({ agy: { models: { env: {} } } }));
      await writeFile(explicitPath, JSON.stringify({ agy: { models: { explicit: {} } } }));

      const explicit = await loadModelsConfigInChild({
        cwd: project,
        home,
        explicitPath,
        envPath,
      });
      assertLoaded(explicit);
      expect(explicit.loaded.path).toBe(explicitPath);
      expect(Object.keys(explicit.loaded.config.agy?.models ?? {})).toEqual(["explicit"]);

      const missingExplicit = join(root, "missing-explicit.jsonc");
      const explicitMissing = await loadModelsConfigInChild({
        cwd: project,
        home,
        explicitPath: missingExplicit,
        envPath,
      });
      assertLoaded(explicitMissing);
      expect(explicitMissing.loaded).toEqual({
        path: missingExplicit,
        config: {},
        exists: false,
      });

      const fromEnv = await loadModelsConfigInChild({
        cwd: project,
        home,
        envPath,
      });
      assertLoaded(fromEnv);
      expect(fromEnv.loaded.path).toBe(envPath);
      expect(Object.keys(fromEnv.loaded.config.agy?.models ?? {})).toEqual(["env"]);

      const missingEnv = join(root, "missing-env.jsonc");
      const envMissing = await loadModelsConfigInChild({
        cwd: project,
        home,
        envPath: missingEnv,
      });
      assertLoaded(envMissing);
      expect(envMissing.loaded).toEqual({
        path: missingEnv,
        config: {},
        exists: false,
      });

      const fromProject = await loadModelsConfigInChild({ cwd: project, home });
      assertLoaded(fromProject);
      expect(fromProject.loaded.path).toBe(projectPath);
      expect(Object.keys(fromProject.loaded.config.agy?.models ?? {})).toEqual(["project"]);

      await writeFile(projectPath, "{}", "utf-8");
      const emptyProject = await loadModelsConfigInChild({
        cwd: project,
        home,
      });
      assertLoaded(emptyProject);
      expect(emptyProject.loaded).toEqual({
        path: projectPath,
        config: {},
        exists: true,
      });

      await rm(projectPath);
      const fromHome = await loadModelsConfigInChild({ cwd: project, home });
      assertLoaded(fromHome);
      expect(fromHome.loaded.path).toBe(homePath);
      expect(Object.keys(fromHome.loaded.config.agy?.models ?? {})).toEqual(["home"]);

      await rm(homePath);
      const bothMissing = await loadModelsConfigInChild({ cwd: project, home });
      assertLoaded(bothMissing);
      expect(bothMissing.loaded).toEqual({
        path: projectPath,
        config: {},
        exists: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not fall back to home for malformed or non-ENOENT project errors", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-models-project-error-")));
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    try {
      const projectPath = await writeModelsConfig(project, {});
      await writeModelsConfig(home, { agy: { models: { home: {} } } });
      await writeFile(projectPath, "{ malformed", "utf-8");

      const malformed = await loadModelsConfigInChild({ cwd: project, home });
      expect(malformed.ok).toBe(false);
      if (malformed.ok) expect.fail("expected malformed project config to fail");
      expect(malformed.message).toMatch(/Invalid JSONC in models config/);
      expect(malformed.message.includes(projectPath)).toBeTruthy();

      await rm(projectPath);
      await mkdir(projectPath);
      const readError = await loadModelsConfigInChild({ cwd: project, home });
      expect(readError.ok).toBe(false);
      if (readError.ok) expect.fail("expected project read error to fail");
      expect(readError.code).toBe("EISDIR");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles identical project and home config paths", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-models-same-path-")));
    try {
      const path = await writeModelsConfig(root, {
        agy: { models: { same: { name: "Same path" } } },
      });
      const present = await loadModelsConfigInChild({ cwd: root, home: root });
      assertLoaded(present);
      expect(present.loaded.path).toBe(path);
      expect(Object.keys(present.loaded.config.agy?.models ?? {})).toEqual(["same"]);

      await rm(path);
      const missing = await loadModelsConfigInChild({ cwd: root, home: root });
      assertLoaded(missing);
      expect(missing.loaded).toEqual({ path, config: {}, exists: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parseModelsConfig accepts agent model sections", () => {
    const cfg = parseModelsConfig({
      agy: {
        models: {
          m1: { name: "M1", variants: ["high", "low"], defaultVariant: "high" },
        },
      },
      ignored: { models: { x: {} } },
    });
    expect(Object.keys(cfg.agy?.models ?? {})).toEqual(["m1"]);
    expect(cfg.agy?.models?.m1?.defaultVariant).toBe("high");
    expect((cfg as Record<string, unknown>).ignored).toBe(undefined);
  });

  it("resolveAgentCatalog returns empty when section missing", () => {
    const out = resolveAgentCatalog("agy", {}, (id, e) => ({
      name: e.name ?? id,
    }));
    expect(out).toEqual({});
  });

  it("resolveAgentCatalog maps section models", () => {
    const out = resolveAgentCatalog("agy", { agy: { models: { b: { name: "B" } } } }, (id, e) => ({
      name: e.name ?? id,
    }));
    expect(out).toEqual({ b: { name: "B" } });
  });

  it("loadModelsConfigFile + discoverModels honor config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-models-cfg-"));
    const path = join(dir, "models.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          agy: {
            models: {
              "custom-agy": {
                name: "Custom Agy",
                variants: ["high"],
                defaultVariant: "high",
              },
            },
          },
        }),
        "utf-8",
      );

      const loaded = await loadModelsConfigFile(path);
      expect(loaded.exists).toBe(true);

      const agy = await discoverAgy({ configPath: path });
      expect(agy.models.map((m) => m.id)).toEqual(["custom-agy"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads comments and trailing commas from a JSONC config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-models-jsonc-"));
    const path = join(dir, "pi-agent-bridge.jsonc");
    try {
      await writeFile(
        path,
        `// top-level comment
{
  /* agent section */
  "agy": {
    "models": {
      "jsonc-agy": {
        "name": "JSONC Agy",
        "variants": ["high", "low",],
        "defaultVariant": "high",
      },
    },
  },
}
`,
        "utf-8",
      );

      const loaded = await loadModelsConfigFile(path);
      expect(loaded.exists).toBe(true);
      expect(loaded.config.agy?.models?.["jsonc-agy"]?.name).toBe("JSONC Agy");
      const agy = await discoverAgy({ configPath: path });
      expect(agy.models.map((model) => model.id)).toEqual(["jsonc-agy"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports the config path for malformed JSONC", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-models-invalid-jsonc-"));
    const path = join(dir, "pi-agent-bridge.jsonc");
    try {
      await writeFile(path, '{\n  "agy": { "models": {, }, },\n}\n', "utf-8");
      try {
        await loadModelsConfigFile(path);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBeTruthy();
        expect((error as Error).message).toMatch(/Invalid JSONC in models config/);
        expect((error as Error).message.includes(path)).toBeTruthy();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("missing config file yields empty catalogs", async () => {
    const missing = join(tmpdir(), `pi-models-missing-${Date.now()}.json`);
    const agy = await discoverAgy({ configPath: missing });
    expect(agy.models.length).toBe(0);
  });
});

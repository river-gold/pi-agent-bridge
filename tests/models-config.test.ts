import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { discoverModels as discoverAgy } from "../src/agy/agy-models.ts";
import {
	defaultModelsConfigPath,
	loadModelsConfigFile,
	parseModelsConfig,
	resolveAgentCatalog,
	resolveModelsConfigPath,
	type ModelsConfigFile,
} from "../src/shared/models-config.ts";

const execFileAsync = promisify(execFile);
const modelsConfigModuleUrl = new URL(
	"../src/shared/models-config.ts",
	import.meta.url,
).href;
const relativeConfigPath = join(".pi", "agent", "pi-agent-bridge.jsonc");

type ChildLoadResult =
	| {
			ok: true;
			loaded: { path: string; config: ModelsConfigFile; exists: boolean };
	  }
	| { ok: false; code?: string; message: string };

async function writeModelsConfig(
	baseDir: string,
	config: unknown,
): Promise<string> {
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
	assert.equal(result.ok, true, result.ok ? undefined : result.message);
}

describe("models-config", () => {
	it("resolveModelsConfigPath prefers override then env then cwd default", async () => {
		const prev = process.env.PI_AGENT_BRIDGE_CONFIG;
		const prevCwd = process.cwd();
		const dir = await mkdtemp(join(tmpdir(), "pi-models-path-"));
		try {
			process.chdir(dir);
			delete process.env.PI_AGENT_BRIDGE_CONFIG;
			const cwdDefault = join(
				process.cwd(),
				".pi",
				"agent",
				"pi-agent-bridge.jsonc",
			);
			assert.equal(defaultModelsConfigPath(), cwdDefault);
			assert.equal(resolveModelsConfigPath(), cwdDefault);
			assert.equal(resolveModelsConfigPath("/tmp/x.json"), "/tmp/x.json");
			process.env.PI_AGENT_BRIDGE_CONFIG = "/tmp/env.json";
			assert.equal(resolveModelsConfigPath(), "/tmp/env.json");
			assert.equal(
				resolveModelsConfigPath("/tmp/override.json"),
				"/tmp/override.json",
			);
		} finally {
			process.chdir(prevCwd);
			if (prev === undefined) delete process.env.PI_AGENT_BRIDGE_CONFIG;
			else process.env.PI_AGENT_BRIDGE_CONFIG = prev;
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads explicit, env, project, then home without cross-file merging", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "pi-models-default-")),
		);
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
			await writeFile(
				envPath,
				JSON.stringify({ agy: { models: { env: {} } } }),
			);
			await writeFile(
				explicitPath,
				JSON.stringify({ agy: { models: { explicit: {} } } }),
			);

			const explicit = await loadModelsConfigInChild({
				cwd: project,
				home,
				explicitPath,
				envPath,
			});
			assertLoaded(explicit);
			assert.equal(explicit.loaded.path, explicitPath);
			assert.deepEqual(Object.keys(explicit.loaded.config.agy?.models ?? {}), [
				"explicit",
			]);

			const missingExplicit = join(root, "missing-explicit.jsonc");
			const explicitMissing = await loadModelsConfigInChild({
				cwd: project,
				home,
				explicitPath: missingExplicit,
				envPath,
			});
			assertLoaded(explicitMissing);
			assert.deepEqual(explicitMissing.loaded, {
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
			assert.equal(fromEnv.loaded.path, envPath);
			assert.deepEqual(Object.keys(fromEnv.loaded.config.agy?.models ?? {}), [
				"env",
			]);

			const missingEnv = join(root, "missing-env.jsonc");
			const envMissing = await loadModelsConfigInChild({
				cwd: project,
				home,
				envPath: missingEnv,
			});
			assertLoaded(envMissing);
			assert.deepEqual(envMissing.loaded, {
				path: missingEnv,
				config: {},
				exists: false,
			});

			const fromProject = await loadModelsConfigInChild({ cwd: project, home });
			assertLoaded(fromProject);
			assert.equal(fromProject.loaded.path, projectPath);
			assert.deepEqual(
				Object.keys(fromProject.loaded.config.agy?.models ?? {}),
				["project"],
			);

			await writeFile(projectPath, "{}", "utf-8");
			const emptyProject = await loadModelsConfigInChild({
				cwd: project,
				home,
			});
			assertLoaded(emptyProject);
			assert.deepEqual(emptyProject.loaded, {
				path: projectPath,
				config: {},
				exists: true,
			});

			await rm(projectPath);
			const fromHome = await loadModelsConfigInChild({ cwd: project, home });
			assertLoaded(fromHome);
			assert.equal(fromHome.loaded.path, homePath);
			assert.deepEqual(Object.keys(fromHome.loaded.config.agy?.models ?? {}), [
				"home",
			]);

			await rm(homePath);
			const bothMissing = await loadModelsConfigInChild({ cwd: project, home });
			assertLoaded(bothMissing);
			assert.deepEqual(bothMissing.loaded, {
				path: projectPath,
				config: {},
				exists: false,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not fall back to home for malformed or non-ENOENT project errors", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "pi-models-project-error-")),
		);
		const project = join(root, "project");
		const home = join(root, "home");
		await mkdir(project, { recursive: true });
		try {
			const projectPath = await writeModelsConfig(project, {});
			await writeModelsConfig(home, { agy: { models: { home: {} } } });
			await writeFile(projectPath, "{ malformed", "utf-8");

			const malformed = await loadModelsConfigInChild({ cwd: project, home });
			assert.equal(malformed.ok, false);
			if (malformed.ok)
				assert.fail("expected malformed project config to fail");
			assert.match(malformed.message, /Invalid JSONC in models config/);
			assert.ok(malformed.message.includes(projectPath));

			await rm(projectPath);
			await mkdir(projectPath);
			const readError = await loadModelsConfigInChild({ cwd: project, home });
			assert.equal(readError.ok, false);
			if (readError.ok) assert.fail("expected project read error to fail");
			assert.equal(readError.code, "EISDIR");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("handles identical project and home config paths", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "pi-models-same-path-")),
		);
		try {
			const path = await writeModelsConfig(root, {
				agy: { models: { same: { name: "Same path" } } },
			});
			const present = await loadModelsConfigInChild({ cwd: root, home: root });
			assertLoaded(present);
			assert.equal(present.loaded.path, path);
			assert.deepEqual(Object.keys(present.loaded.config.agy?.models ?? {}), [
				"same",
			]);

			await rm(path);
			const missing = await loadModelsConfigInChild({ cwd: root, home: root });
			assertLoaded(missing);
			assert.deepEqual(missing.loaded, { path, config: {}, exists: false });
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
		assert.deepEqual(Object.keys(cfg.agy?.models ?? {}), ["m1"]);
		assert.equal(cfg.agy?.models?.m1?.defaultVariant, "high");
		assert.equal((cfg as Record<string, unknown>).ignored, undefined);
	});

	it("resolveAgentCatalog returns empty when section missing", () => {
		const out = resolveAgentCatalog("agy", {}, (id, e) => ({
			name: e.name ?? id,
		}));
		assert.deepEqual(out, {});
	});

	it("resolveAgentCatalog maps section models", () => {
		const out = resolveAgentCatalog(
			"agy",
			{ agy: { models: { b: { name: "B" } } } },
			(id, e) => ({ name: e.name ?? id }),
		);
		assert.deepEqual(out, { b: { name: "B" } });
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
			assert.equal(loaded.exists, true);

			const agy = await discoverAgy({ configPath: path });
			assert.deepEqual(
				agy.models.map((m) => m.id),
				["custom-agy"],
			);
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
			assert.equal(loaded.exists, true);
			assert.equal(loaded.config.agy?.models?.["jsonc-agy"]?.name, "JSONC Agy");
			const agy = await discoverAgy({ configPath: path });
			assert.deepEqual(
				agy.models.map((model) => model.id),
				["jsonc-agy"],
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reports the config path for malformed JSONC", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-models-invalid-jsonc-"));
		const path = join(dir, "pi-agent-bridge.jsonc");
		try {
			await writeFile(path, '{\n  "agy": { "models": {, }, },\n}\n', "utf-8");
			await assert.rejects(loadModelsConfigFile(path), (error: unknown) => {
				assert.ok(error instanceof Error);
				assert.match(error.message, /Invalid JSONC in models config/);
				assert.ok(error.message.includes(path));
				return true;
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("missing config file yields empty catalogs", async () => {
		const missing = join(tmpdir(), "pi-models-missing-" + Date.now() + ".json");
		const agy = await discoverAgy({ configPath: missing });
		assert.equal(agy.models.length, 0);
	});
});

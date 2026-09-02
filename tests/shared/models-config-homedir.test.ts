import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as os from "node:os";
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadModelsConfigFile } from "../../src/shared/models-config.ts";

describe("models-config homedir", () => {
  afterEach(()=>vi.restoreAllMocks());

  it("identical project and home path", async () => {
    const tmp=await mkdtemp(join(tmpdir(),"homedir-"));
    const { realpath } = await import("node:fs/promises");
    const dir=await realpath(tmp);
    const origHome=process.env.HOME; process.env.HOME=dir;
    const origCwd=process.cwd(); process.chdir(dir);
    // ensure file exists at dir/.pi/agent/pi-agent-bridge.jsonc
    const cfgPath=join(dir,".pi","agent","pi-agent-bridge.jsonc");
    await mkdir(join(dir,".pi","agent"),{recursive:true});
    await writeFile(cfgPath, JSON.stringify({agy:{models:{m1:{name:"M1"}}}}));
    const loaded=await loadModelsConfigFile();
    expect(loaded.path.endsWith(".pi/agent/pi-agent-bridge.jsonc")).toBe(true);
    expect(loaded.exists).toBe(true);
    process.chdir(origCwd); if(origHome===undefined) delete process.env.HOME; else process.env.HOME=origHome;
    await rm(dir,{recursive:true,force:true});
  });

  it("home fallback", async () => {
    const proj=await mkdtemp(join(tmpdir(),"proj-"));
    const home=await mkdtemp(join(tmpdir(),"home-"));
    const origHome=process.env.HOME; process.env.HOME=home;
    const origCwd=process.cwd(); process.chdir(proj);
    const homePath=join(home,".pi","agent","pi-agent-bridge.jsonc");
    await mkdir(join(home,".pi","agent"),{recursive:true});
    await writeFile(homePath, JSON.stringify({agy:{models:{homeM:{}}}}));
    const loaded=await loadModelsConfigFile();
    expect(loaded.path).toBe(homePath);
    expect(loaded.config.agy?.models?.homeM).toBeDefined();
    process.chdir(origCwd); if(origHome===undefined) delete process.env.HOME; else process.env.HOME=origHome;
    await rm(proj,{recursive:true,force:true});
    await rm(home,{recursive:true,force:true});
  });

  it("both missing returns project path empty", async () => {
    const proj=await mkdtemp(join(tmpdir(),"proj2-"));
    const home=await mkdtemp(join(tmpdir(),"home2-"));
    const origHome=process.env.HOME; process.env.HOME=home;
    const origCwd=process.cwd(); process.chdir(proj);
    const loaded=await loadModelsConfigFile();
    expect(loaded.exists).toBe(false);
    process.chdir(origCwd); if(origHome===undefined) delete process.env.HOME; else process.env.HOME=origHome;
    await rm(proj,{recursive:true,force:true});
    await rm(home,{recursive:true,force:true});
  });
  it("identical path no file hits homePath===projectPath", async () => {
    const tmp=await mkdtemp(join(tmpdir(),"homedir2-"));
    const { realpath } = await import("node:fs/promises");
    const dir=await realpath(tmp);
    const origHome=process.env.HOME; process.env.HOME=dir;
    const origCwd=process.cwd(); process.chdir(dir);
    // ensure no file exists
    const loaded=await loadModelsConfigFile();
    expect(loaded.exists).toBe(false);
    expect(loaded.path.endsWith(".pi/agent/pi-agent-bridge.jsonc")).toBe(true);
    process.chdir(origCwd); if(origHome===undefined) delete process.env.HOME; else process.env.HOME=origHome;
    await rm(dir,{recursive:true,force:true});
  });
});

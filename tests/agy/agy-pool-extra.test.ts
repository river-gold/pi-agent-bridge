import { chmod, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgyPool, compositeKey, hashCwd } from "../../src/agy/agy-pool.ts";

function mockTemplate(handler: string): string {
  return `import { createInterface } from "node:readline";
const conv="conv-"+Math.random();
console.log(JSON.stringify({event:"init",conversation_id:conv}));
const rl=createInterface({input:process.stdin});
rl.on("line", async (line)=>{
  let msg; try{msg=JSON.parse(line);}catch{return;}
  if(msg.event!=="user") return;
  const prompt=msg.message?.content||"";
  ${handler}
});`;
}
async function makeMock(dir:string, handler:string){
  const js=join(dir, `mock-${Date.now()}-${Math.random()}.mjs`);
  const wrap=join(dir, `wrap-${Date.now()}-${Math.random()}`);
  await writeFile(js, mockTemplate(handler));
  await writeFile(wrap, `#!/usr/bin/env bash\nexec ${process.execPath} ${JSON.stringify(js)} "$@"\n`);
  await chmod(js,0o755); await chmod(wrap,0o755);
  return wrap;
}

describe("agy-pool extra", () => {
  it("hashCwd and compositeKey", () => {
    expect(hashCwd("x").length).toBe(16);
    expect(compositeKey("  ", "/tmp")).toContain("default::");
    expect(compositeKey("sid", "/tmp")).toContain("sid::");
  });
  it("idleTimeout 0 no timer", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool-"));
    const wrap=await makeMock(dir, `console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",text_delta:"hi",state:"DONE",conversation_id:conv}})); console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"hi",conversation_id:conv}}));`);
    const pool=new AgyPool({binary:wrap, idleTimeoutMs:0, timeoutMs:2000});
    const r=await pool.acquire("s","/tmp").prompt("hello");
    expect(r.stdout).toBe("hi");
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
  it("maxEntries eviction", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool2-"));
    const wrap=await makeMock(dir, `console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",text_delta:"echo:"+prompt,state:"DONE",conversation_id:conv}})); console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"echo:"+prompt,conversation_id:conv}}));`);
    await mkdir("/tmp/a",{recursive:true}); await mkdir("/tmp/b",{recursive:true});
    const pool=new AgyPool({binary:wrap, maxEntries:1, idleTimeoutMs:60000, timeoutMs:2000});
    await pool.acquire("s1","/tmp/a").prompt("a");
    await pool.acquire("s2","/tmp/b").prompt("b");
    expect(pool.size()).toBe(1);
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
  it("abort signal", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool3-"));
    const wrap=await makeMock(dir, `await new Promise(r=>setTimeout(r,500)); console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"late",conversation_id:conv}}));`);
    const pool=new AgyPool({binary:wrap, timeoutMs:3000});
    const ctrl=new AbortController();
    const p=pool.acquire("s","/tmp").prompt("hi",{signal:ctrl.signal});
    setTimeout(()=>ctrl.abort(),20);
    await expect(p).rejects.toThrow();
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
  it("already aborted", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool4-"));
    const wrap=await makeMock(dir, `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"x",conversation_id:conv}}));`);
    const pool=new AgyPool({binary:wrap});
    const ctrl=new AbortController(); ctrl.abort();
    await expect(pool.acquire("s","/tmp").prompt("hi",{signal:ctrl.signal})).rejects.toThrow();
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
  it("handle invalid lines and events", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool5-"));
    const wrap=await makeMock(dir, `
      console.log("not json");
      console.log(JSON.stringify({event:123}));
      console.log(JSON.stringify({event:"step_update",step_update:{step_type:"tool",tool_name:"bash",tool_info:{parameters:{cmd:"ls"}},state:"ACTIVE",conversation_id:conv}}));
      console.log(JSON.stringify({event:"step_update",step_update:{step_type:"tool",tool_name:"bash",tool_info:{parameters:{cmd:"ls"},output:"out"},state:"DONE",conversation_id:conv}}));
      console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",text_delta:"part",state:"ACTIVE",conversation_id:conv}}));
      console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",text_delta:"part2",status:"DONE",conversation_id:conv}}));
      console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"done",usage:{input_tokens:1,output_tokens:1,total_tokens:2},conversation_id:conv}}));
    `);
    const pool=new AgyPool({binary:wrap, timeoutMs:2000});
    const events:any[]=[];
    const r=await pool.acquire("s","/tmp").prompt("hi",{onEvent:e=>events.push(e)});
    expect(r.stdout).toBeTruthy();
    expect(events.some((e:any)=>e.type==="tool_start")).toBe(true);
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
  it("spawn with model effort conversationId args", async () => {
    const dir=await mkdtemp(join(tmpdir(),"pool6-"));
    const wrap=await makeMock(dir, `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"ok",conversation_id:conv}}));`);
    const pool=new AgyPool({binary:wrap, extraArgs:["--extra"], timeoutMs:2000});
    const h=pool.acquire("s","/tmp","my-model","  high  ","conv-123");
    expect(h.key).toBeTruthy();
    expect(h.cwd).toBe("/tmp");
    await h.prompt("hi");
    await h.dispose();
    await pool.disposeAll();
    await rm(dir,{recursive:true,force:true});
  });
});

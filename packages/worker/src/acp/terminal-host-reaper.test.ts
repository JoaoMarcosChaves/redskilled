import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { isLivePid } from "@reddb-io/shared/kill-tree.js";
import { createWorkerTerminalHost } from "./terminal-host.js";
const pids:number[]=[];const roots:string[]=[];
afterEach(async()=>{for(const pid of pids.splice(0)){try{process.kill(pid,"SIGKILL");}catch{}}for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it("closing a terminal host kills the shell's grandchild instead of leaving validation orphaned",async()=>{
  const root=await mkdtemp(join(tmpdir(),"terminal-reap-"));roots.push(root);const pidfile=join(root,"grandchild.pid");
  const host=createWorkerTerminalHost({cwd:root,env:process.env,spawn:(...args:Parameters<typeof nodeSpawn>)=>{const child=nodeSpawn(...args);if(child.pid!=null)pids.push(child.pid);return child;}});
  host.create({sessionId:"s",command:process.execPath,args:["-e",`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)`,pidfile]});
  let grandchild=0;await expect.poll(async()=>{grandchild=Number(await readFile(pidfile,"utf8").catch(()=>"0"));return grandchild;}).toBeGreaterThan(0);pids.push(grandchild);expect(isLivePid(grandchild)).toBe(true);
  host.closeAll();await expect.poll(()=>isLivePid(grandchild),{timeout:1500}).toBe(false);
});

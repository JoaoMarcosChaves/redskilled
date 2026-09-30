import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWorkflowWorker, type ActiveWorkflowWorker } from "../src/acp-worker-lifecycle.js";
import { materializeWorkerWorkspace } from "../src/worker-workspace.js";
import { retainWorkerGit } from "../src/worker-git-evidence.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
const git = (cwd: string, ...args: string[]) => execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),"worker-git-recovery-"));roots.push(root);
  const project=join(root,"project");await mkdir(project);git(project,"init","-b","main");git(project,"config","user.name","Test");git(project,"config","user.email","test@example.com");
  await writeFile(join(project,"file.txt"),"base\n");await writeFile(join(project,"binary.bin"),Buffer.from([0,1,2,3]));git(project,"add",".");git(project,"commit","-m","base");
  const workspace=await materializeWorkerWorkspace({root:join(root,"workers"),workerId:"VWzzzzz",projectWorkspacePath:project});
  git(workspace.worktreePath,"config","user.name","Test");git(workspace.worktreePath,"config","user.email","test@example.com");
  const worker={workerId:workspace.workerId,workspace,evidence:{root:join(root,"evidence"),ttlMs:86400000},downstreamSessionId:"downstream",connection:{close:()=>undefined},socket:new Socket(),endpoint:join(root,"test.sock"),publicSessionId:"session",notify:async()=>undefined,cancelled:false,cleaned:false} as unknown as ActiveWorkflowWorker;
  return {root,project,workspace,worker};
}

it("recovers a unique commit, binary dirty edits and untracked files after cleanup deletes the private clone", async () => {
  const {root,project,workspace,worker}=await fixture();
  await writeFile(join(workspace.worktreePath,"file.txt"),"implemented\n");git(workspace.worktreePath,"add",".");git(workspace.worktreePath,"commit","-m","work");
  const head=git(workspace.worktreePath,"rev-parse","HEAD");
  git(workspace.worktreePath,"checkout","--detach",head);
  await writeFile(join(workspace.worktreePath,"file.txt"),"implemented\nunfinished\n");
  await writeFile(join(workspace.worktreePath,"binary.bin"),Buffer.from([0,9,8,7]));
  await writeFile(join(workspace.worktreePath,"draft.txt"),"untracked work\n");
  await symlink("draft.txt",join(workspace.worktreePath,"draft-link"));
  await writeFile(join(workspace.workspacePath,"gate-output.toonl"),"exit_code: 1\nline: assertion failed\n");
  cleanupWorkflowWorker("session",worker,new Map([["session",worker]]),"gate-blocked");
  const lane=join(root,"evidence",workspace.workerId);
  await vi.waitFor(()=>expect(existsSync(workspace.workspacePath)).toBe(false));
  git(project,"fetch",join(lane,"work.bundle"),"HEAD");
  expect(git(project,"rev-parse","FETCH_HEAD")).toBe(head);
  git(project,"checkout","--detach","FETCH_HEAD");git(project,"apply",join(lane,"worktree.patch"));
  expect(await readFile(join(project,"file.txt"),"utf8")).toBe("implemented\nunfinished\n");
  expect(await readFile(join(project,"binary.bin"))).toEqual(Buffer.from([0,9,8,7]));
  expect(await readFile(join(lane,"untracked","draft.txt"),"utf8")).toBe("untracked work\n");
  expect(await readlink(join(lane,"untracked","draft-link"))).toBe("draft.txt");
  expect(await readFile(join(lane,"gate-output.toonl"),"utf8")).toContain("assertion failed");
},10000);

it("keeps the workspace and reports failure when durable evidence cannot be written", async () => {
  const {root,workspace,worker}=await fixture();
  await writeFile(join(root,"evidence"),"blocks evidence directory");
  const stderr=vi.spyOn(process.stderr,"write").mockReturnValue(true);
  cleanupWorkflowWorker("session",worker,new Map([["session",worker]]),"gate-blocked");
  await vi.waitFor(()=>expect(stderr).toHaveBeenCalledWith(expect.stringContaining("workspace preserved")));
  expect(existsSync(workspace.workspacePath)).toBe(true);
});

it("waits for the admitted process to exit before retaining its final edit", async () => {
  const {root,workspace,worker}=await fixture();
  const child=spawn(process.execPath,["-e",'setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"last edit before exit\\n"),50)',join(workspace.worktreePath,"file.txt")],{stdio:"ignore"});
  cleanupWorkflowWorker("session",{...worker,process:child},new Map(),"gate-blocked");
  await vi.waitFor(()=>expect(existsSync(workspace.workspacePath)).toBe(false));
  const patch=await readFile(join(root,"evidence",workspace.workerId,"worktree.patch"),"utf8");
  expect(patch).toContain("last edit before exit");
});

it("preserves the clone when an existing gate-output artifact cannot be copied", async () => {
  const {workspace,worker}=await fixture();
  await mkdir(join(workspace.workspacePath,"gate-output.toonl"));
  const stderr=vi.spyOn(process.stderr,"write").mockReturnValue(true);
  cleanupWorkflowWorker("session",worker,new Map(),"gate-blocked");
  await vi.waitFor(()=>expect(stderr).toHaveBeenCalledWith(expect.stringContaining("workspace preserved")));
  expect(existsSync(workspace.workspacePath)).toBe(true);
});

it("retains a self-contained bundle when the Worker created a repository without a known fork base", async () => {
  const {root,workspace}=await fixture();
  const evidence=join(root,"new-repository-evidence");await mkdir(evidence);
  await retainWorkerGit({...workspace,baseCommit:undefined},evidence);
  const recovery=join(root,"empty-recovery");await mkdir(recovery);git(recovery,"init");
  git(recovery,"fetch",join(evidence,"work.bundle"),"HEAD");
  expect(git(recovery,"rev-parse","FETCH_HEAD")).toBe(git(workspace.worktreePath,"rev-parse","HEAD"));
});

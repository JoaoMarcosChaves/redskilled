import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdir, readlink, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { encode } from "@reddb-io/toon";
import type { MaterializedWorkerWorkspace } from "./worker-workspace.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile("git", args, {cwd, timeout:30_000,maxBuffer:64*1024*1024}, (error, stdout) => error == null ? resolve(stdout) : reject(error)));
}

/** Keep unique Git objects and edits before their private clone is released. A failure forbids deletion. */
export async function retainWorkerGit(workspace: MaterializedWorkerWorkspace, evidenceDir: string): Promise<string> {
  const marker = await stat(join(workspace.worktreePath, ".git")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && workspace.baseCommit == null) return undefined;
    throw error;
  });
  if (marker == null) return "not-a-repository";
  const head = (await git(workspace.worktreePath, ["rev-parse", "HEAD"])).trim();
  const base = workspace.baseCommit;
  let bundle: string | undefined;
  if (base !== head) {
    const delta = base == null ? [] : await git(workspace.worktreePath, ["merge-base", "--is-ancestor", base, head]).then(() => [`^${base}`], () => []);
    bundle = "work.bundle";
    await git(workspace.worktreePath, ["bundle", "create", join(evidenceDir, `${bundle}.tmp`), "HEAD", ...delta]);
    await git(workspace.worktreePath, ["bundle", "verify", join(evidenceDir, `${bundle}.tmp`)]);
    await rename(join(evidenceDir, `${bundle}.tmp`), join(evidenceDir, bundle));
    await chmod(join(evidenceDir, bundle), 0o600);
  }
  const patch = await git(workspace.worktreePath, ["diff", "--binary", "HEAD"]);
  await writeFile(join(evidenceDir, "worktree.patch"), patch, {mode:0o600});
  const names = (await git(workspace.worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const name of names) {
    if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("unsafe untracked evidence path");
    const destination = join(evidenceDir, "untracked", name);
    await mkdir(dirname(destination), {recursive:true,mode:0o700});
    await cp(join(workspace.worktreePath, name), destination, {dereference:false,verbatimSymlinks:true});
  }
  if ((await git(workspace.worktreePath,["rev-parse","HEAD"])).trim() !== head) throw new Error("Worker HEAD changed during evidence retention; preserving workspace");
  if (await git(workspace.worktreePath,["diff","--binary","HEAD"]) !== patch) throw new Error("Worker patch changed during evidence retention; preserving workspace");
  const finalNames=(await git(workspace.worktreePath,["ls-files","--others","--exclude-standard","-z"])).split("\0").filter(Boolean);
  if (finalNames.join("\0") !== names.join("\0")) throw new Error("Worker untracked paths changed during evidence retention; preserving workspace");
  for (const name of names) {
    const source=join(workspace.worktreePath,name), destination=join(evidenceDir,"untracked",name);
    const symlink=(await lstat(source)).isSymbolicLink();
    const match=symlink ? await readlink(source) === await readlink(destination) : await git(workspace.worktreePath,["hash-object","--no-filters","--",source,destination]).then(output=>{const hashes=output.trim().split("\n");return hashes.length===2&&hashes[0]===hashes[1]});
    if (!match) throw new Error("Worker untracked content changed during evidence retention; preserving workspace");
  }
  await writeFile(join(evidenceDir, "work.toon"), encode({version:1,head,base_commit:base ?? null,bundle:bundle ?? null,patch:"worktree.patch",untracked:names}), {mode:0o600});
  return "retained";
}

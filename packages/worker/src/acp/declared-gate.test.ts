import { describe, expect, it } from "vitest";

import { runWorkerLocalGate } from "./local-gate.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * The declared schedule is the sole local validation authority (#4166): a
 * Worker handed `validation_commands` runs exactly those and never improvises
 * the package-cone suite, which contradicted the declaration and flaked under
 * the Worker memory ceiling — a different package red each round.
 */
describe("the Worker gate runs the declared commands", () => {
  it("waits for real command exit and records a failure despite green text on stdout", async () => {
    const root=await mkdtemp(join(tmpdir(),"gate-exit-"));
    try {
      const command=`"${process.execPath}" -e 'console.log("green then FAIL route.test.ts AssertionError");console.error("turbo summary");setTimeout(()=>process.exit(9),20)'`;
      const result=await runWorkerLocalGate({worktree:root,base:"main",outputPath:join(root,"output.toonl"),validationCommands:[command]});
      expect(result.checks[0]?.record.exitCode).toBe(9);
      expect(result.stages.find(stage=>stage.stage==="feedback")?.ok).toBe(false);
      expect(result.detail).toContain("route.test.ts AssertionError");
      expect(result.detail).toContain("turbo summary");
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it("retains stdout assertions even when stderr contains only a wrapper summary", async () => {
    const root = await mkdtemp(join(tmpdir(),"gate-output-"));
    const outputPath=join(root,"gate-output.toonl");
    try {
      const result=await runWorkerLocalGate({worktree:root,base:"main",outputPath,validationCommands:["gate"],backpressureExec:async()=>({code:1,stdout:"FAIL patient-route.test.ts\nAssertionError: expected edit route\ntoken=sk-privatevalue123\n",stderr:"turbo: command exited (1)\n"})});
      expect(result.detail).toContain("AssertionError: expected edit route");
      expect(result.detail).toContain("turbo: command exited (1)");
      expect(result.detail).not.toContain("sk-privatevalue123");
      const artifact=await readFile(outputPath,"utf8");
      expect(artifact).toContain("patient-route.test.ts");
      expect(artifact).toContain("stderr");
      expect(artifact).not.toContain("sk-privatevalue123");
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  it("runs them in order as the feedback stage and stops at the first failure", async () => {
    const ran: string[] = [];
    const result = await runWorkerLocalGate({
      worktree: "/tmp/wt",
      base: "main",
      validationCommands: ["pnpm typecheck", "pnpm -C apps/plugin-dev test:invariants", "never-reached"],
      backpressureExec: async ({ command }) => {
        ran.push(command);
        return command === "pnpm -C apps/plugin-dev test:invariants"
          ? { code: 1, stdout: "", stderr: "invariant broke: lane unregistered" }
          : { code: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(ran).toEqual(["pnpm typecheck", "pnpm -C apps/plugin-dev test:invariants"]);
    expect(result.stages.find((stage) => stage.stage === "feedback")?.ok).toBe(false);
    expect(result.detail).toContain("invariant broke: lane unregistered");
  });

  it("passes clean and still runs backpressure afterwards", async () => {
    const ran: string[] = [];
    const result = await runWorkerLocalGate({
      worktree: "/tmp/wt",
      base: "main",
      validationCommands: ["pnpm typecheck"],
      backpressureCommands: ["pnpm extra"],
      backpressureExec: async ({ command }) => {
        ran.push(command);
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(ran).toEqual(["pnpm typecheck", "pnpm extra"]);
    expect(result.stages.find((stage) => stage.stage === "feedback")?.ok).toBe(true);
    expect(result.stages.find((stage) => stage.stage === "backpressure")?.ok).toBe(true);
    expect(result.sidecar.length).toBe(2);
  });
});

// The wire's own decoding, including the refinement dropped rather than refused,
// is pinned in `ticket-handoff-contract.test.ts` beside the rest of the contract.

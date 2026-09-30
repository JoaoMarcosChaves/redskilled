import { spawn } from "node:child_process";
import type { AgentConnection } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { childStartupDiagnostic } from "./child-startup-diagnostic.js";
import { WorkflowChildAgent } from "./child-agent.js";

describe("child ACP admission evidence", () => {
  it("reports a missing executable without an unhandled spawn error", async () => {
    const child = new WorkflowChildAgent({
      endpoint: { agent: "codex", transport: "stdio", command: "/redskilled-missing-endpoint-startup-test", args: [] },
      cwd: process.cwd(), mcpServers: [], publicSessionId: "startup-test",
      parent: { notify: async () => undefined, request: async () => ({}) } as unknown as AgentConnection["client"],
    });
    try {
      await expect(child.prompt({sessionId:"startup-test",prompt:[{type:"text",text:"unused"}]})).rejects.toThrow(/failed at spawn;.*ENOENT/);
    } finally { await child.close(); }
  });

  it("reports startup phase, exit status and redacted split stderr through the Worker failure", async () => {
    const child = new WorkflowChildAgent({
      endpoint: { agent: "codex", transport: "stdio", command: process.execPath, args: ["-e", 'process.stderr.write("Permission denied; token=sk-"); setTimeout(()=>{process.stderr.write("privatevalue123\\n");process.exit(126)},10)'] },
      cwd: process.cwd(), mcpServers: [], publicSessionId: "startup-test",
      parent: { notify: async () => undefined, request: async () => ({}) } as unknown as AgentConnection["client"],
    });
    try {
      await expect(child.prompt({sessionId:"startup-test",prompt:[{type:"text",text:"unused"}]})).rejects.toThrow(/initialize; exit=126.*Permission denied; \[REDACTED credential\]/);
    } finally { await child.close(); }
  });

  it("bounds long diagnostics without publishing a truncated sensitive line", async () => {
    const child = spawn(process.execPath, ["-e", 'process.stderr.write("x".repeat(20000));process.exit(1)'], {stdio:["ignore","ignore","pipe"]});
    const diagnostic = childStartupDiagnostic(child);
    const failure = await diagnostic.failure("session/new", new Error("ACP connection closed"));
    expect(failure.message).toContain("session/new; exit=1");
    expect(failure.message).toContain("oversized diagnostic line omitted");
    expect(failure.message.length).toBeLessThan(5000);
  });

  it("bounds empty-line floods and oversized failure causes", async () => {
    const child = spawn(process.execPath, ["-e", 'process.stderr.write("\\n".repeat(100000));process.exit(1)'], {stdio:["ignore","ignore","pipe"]});
    const diagnostic = childStartupDiagnostic(child);
    const failure = await diagnostic.failure("initialize", new Error("x".repeat(100000)));
    expect(failure.message).toContain("oversized failure cause omitted");
    expect(failure.message.length).toBeLessThan(1024);
  });
});

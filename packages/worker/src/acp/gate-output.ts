import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encodeToonlLines } from "@reddb-io/toon";
import { diagnosticLineAssembler, redactDiagnosticLine } from "@reddb-io/shared/diagnostic-log.js";
import type { ExecResult } from "../engine/gate-executor.js";

function safeLines(output: string, emit: (line: string) => void): void {
  const lines = diagnosticLineAssembler((line) => emit(redactDiagnosticLine(line)));
  lines.write(output); lines.flush();
}

/** Preserve both streams, not just Turbo's stderr summary; the daemon retains this artifact at cleanup. */
export function retainGateOutput(path: string | undefined, command: string, run: ExecResult): void {
  if (path == null) return;
  mkdirSync(dirname(path), {recursive:true,mode:0o700});
  const encoder = encodeToonlLines();
  const append = (record: Record<string, unknown>) => appendFileSync(path, encoder.push(record), {mode:0o600});
  append({at:new Date().toISOString(),command:redactDiagnosticLine(command),exit_code:run.code,stream:"result"});
  for (const stream of ["stdout", "stderr"] as const) safeLines(run[stream], (line) => append({stream,line}));
}

/** Bounded operator summary from BOTH streams. Complete sanitized output remains in the artifact. */
export function gateFailureSummary(run: ExecResult): string {
  const summaries: string[] = [];
  for (const stream of ["stdout", "stderr"] as const) {
    const lines: string[] = [];
    safeLines(run[stream], (line) => {
      lines.push(line.length > 4096 ? "[oversized summary line omitted]" : line);
      while (lines.length > 64 || lines.join("\n").length > 8192) lines.shift();
    });
    if (lines.length > 0) summaries.push(`${stream}:\n${lines.join("\n")}`);
  }
  return summaries.join("\n");
}

import type { ChildProcess } from "node:child_process";
import { diagnosticLineAssembler, redactDiagnosticLine } from "@reddb-io/shared/diagnostic-log.js";

/** Retain only complete, redacted lines; adapter stderr may split a credential across chunks. */
export function childStartupDiagnostic(child: ChildProcess) {
  const lines: string[] = [];
  let spawnError: Error | undefined;
  child.once("error", (error) => { spawnError = error; });
  const assembler = diagnosticLineAssembler((line) => {
    const safe = redactDiagnosticLine(line);
    lines.push(safe.length > 4096 ? "[oversized adapter diagnostic omitted]" : safe);
    while (lines.length > 64 || lines.join("\n").length > 4096) lines.shift();
  });
  child.stderr?.on("data", (chunk: Buffer) => assembler.write(chunk));
  child.stderr?.once("end", () => assembler.flush());
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  return {
    async failure(phase: string, cause: unknown): Promise<Error> {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([closed, new Promise<void>((resolve) => { timer = setTimeout(resolve, 250); })]);
      if (timer != null) clearTimeout(timer);
      assembler.flush();
      const effectiveCause = spawnError ?? cause;
      const safeCause = redactDiagnosticLine(effectiveCause instanceof Error ? effectiveCause.message : String(effectiveCause));
      const reason = safeCause.length > 1024 ? "[oversized failure cause omitted]" : safeCause;
      return new Error(`child ACP admission failed at ${spawnError == null ? phase : "spawn"}; exit=${child.exitCode ?? "pending"} signal=${child.signalCode ?? "none"}: ${reason}${lines.length === 0 ? "" : `; stderr: ${lines.join(" | ")}`}`);
    },
  };
}

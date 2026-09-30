import type { ChildProcess } from "node:child_process";

/** A closed ACP socket starts shutdown; the native Worker awaits all child reaps before its own exit. */
export async function awaitWorkerEvidenceBarrier(child: ChildProcess | undefined): Promise<void> {
  if (child == null || child.exitCode != null || child.signalCode != null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.off("close", closed); reject(new Error("Worker has not exited; preserving workspace before evidence capture")); }, 10_000);
    function closed() { clearTimeout(timer); resolve(); }
    child.once("close", closed);
  });
}

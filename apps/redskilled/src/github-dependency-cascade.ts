import { join } from "node:path";
import { executeCloseCascade } from "@reddb-io/worker/engine";
import { loadEngineConfig, readEngineLabelVocabulary } from "@reddb-io/worker/engine";
import type { TrackerIssue, TrackerPort } from "@reddb-io/worker/engine";
import type { RedskilledGithubProjectAuthority, RedskilledGithubProjectReader } from "./github-gateway.js";

/** The existing dependency transition, published through the daemon's durable outbox. */
export async function cascadeMergedTicket(
  reader: RedskilledGithubProjectReader,
  project: RedskilledGithubProjectAuthority,
  ticket: number,
): Promise<void> {
  const labels = readEngineLabelVocabulary(loadEngineConfig(join(project.workspacePath, ".red")));
  const prefix = `repos/${project.projectLabel}`;
  const read = async (path: string) => (await reader.read({ kind:"rest", path })).value;
  const closed = async (issue: number) => {
    const value = await read(`${prefix}/issues/${issue}`);
    return value != null && typeof value === "object" && "state" in value && value.state === "closed";
  };
  if (!await closed(ticket)) {
    await reader.write({idempotency_key:`merge-close:${ticket}`,write:{kind:"issue-transition",issue:ticket,close:true,add:[],remove:[],comment:`Closed after the owning pull request was verified merged.`}});
    // A dated cache cannot stand in for fresh confirmation. Let the same
    // durable obligation retry after the gateway refreshes its issue view.
    if (!await closed(ticket)) throw new Error(`Merged Ticket #${ticket} is awaiting forge closure`);
  }
  const tracker: TrackerPort = {
    async listOpenIssuesByLabel(label) {
      const rows: TrackerIssue[] = [];
      for (let page=1; ; page+=1) {
        const value = await read(`${prefix}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`);
        if (!Array.isArray(value)) throw new Error("Dependency cascade received no issue list");
        for (const raw of value) {
          if (raw.pull_request != null) continue;
          const names = (raw.labels ?? []).map((entry: string | {name:string}) => typeof entry === "string" ? entry : entry.name);
          if (names.some((name: string) => [labels.human, labels.running, labels.quarantine].includes(name))) continue;
          // The existing local transition does not resolve qualified edges;
          // retain them rather than accidentally treating their number as local.
          if (names.some((name: string) => name.startsWith(labels.reqPrefix) && !/^\d+$/.test(name.slice(labels.reqPrefix.length)))) continue;
          rows.push({number:raw.number,body:raw.body ?? "",labels:names});
        }
        if (value.length<100) return rows;
      }
    },
    isIssueClosed: closed,
    async editIssueLabels(issue, mutation) {
      await reader.write({idempotency_key:`cascade:${ticket}:${issue}:labels`,write:{kind:"issue-transition",issue,add:mutation.add,remove:mutation.remove}});
    },
    async commentOnIssue(issue, body) {
      await reader.write({idempotency_key:`cascade:${ticket}:${issue}:audit`,write:{kind:"issue-publication",issue,body}});
    },
    async closeIssue() { throw new Error("Dependency cascade does not close Tickets"); },
  };
  await executeCloseCascade({closedIssue:ticket,tracker,labels});
}

import { dirname, join } from "node:path";
import { readGithubCustodyRecords, type RedskilledGithubCustodyRecord } from "./github-custody.js";
import { carryQueueItems, type RedskilledQueueDiscovery } from "./queue-discovery.js";

/** A Worker ending does not end the durable landing it handed off. */
export function excludeCustodiedQueueItems(
  discovery: RedskilledQueueDiscovery,
  records: readonly RedskilledGithubCustodyRecord[],
): RedskilledQueueDiscovery {
  return { ...discovery, projects: discovery.projects.map((project) => {
    const held = new Set(records.filter((record) => record.project_label === project.project_label &&
      (record.state === "active" || record.terminal_outcome === "merged"))
      .map((record) => String(record.owner_ticket)));
    if (held.size === 0) return project;
    // A count without identities cannot prove any item is outside custody.
    if (project.items == null) return { ...project, depth: project.depth == null ? null : 0,
      detail: `${project.detail}; waiting for listed items outside merge custody` };
    const items = project.items.filter((item) => !held.has(item));
    return { ...project, items, depth: project.depth == null ? null : items.length,
      tickets: project.tickets?.filter((ticket) => !held.has(ticket.id)),
      detail: `${project.detail}; ${project.items.length - items.length} item(s) held by merge custody` };
  }) };
}

/** Carry failed polls, then exclude handoffs from the same authoritative state lane. */
export async function carryQueueItemsOutsideCustody(
  discovery: RedskilledQueueDiscovery,
  previous: RedskilledQueueDiscovery | null,
  eventLanePath: string,
): Promise<RedskilledQueueDiscovery> {
  return excludeCustodiedQueueItems(carryQueueItems(discovery, previous), await readGithubCustodyRecords(
    join(dirname(eventLanePath), "state", "github", "custody.toon"),
  ));
}

import { describe, expect, it } from "vitest";
import { excludeCustodiedQueueItems } from "../src/queue-custody-admission.js";
import type { RedskilledGithubCustodyRecord } from "../src/github-custody.js";
import type { RedskilledQueueDiscovery } from "../src/queue-discovery.js";
const record: RedskilledGithubCustodyRecord = { pull_request:301, owner_ticket:291, branch:"red/worker/291", base:"main", project_id:"github:1", project_label:"acme/widgets", workspace_path:"/tmp/widgets", credential_profile:"personal", handed_off_at:"2026-09-30T00:00:00Z", state:"active", last_tick_at:null, last_forge_state:"unavailable", next_action:"retry-forge", terminal_outcome:null };
const queue: RedskilledQueueDiscovery = { version:1, fetched_at:"2026-09-30T00:01:00Z", request_count:1, project_count:1, batch_size:1, rate_limit:{remaining:null,reset_at:null,exhausted:false}, projects:[{project_label:"acme/widgets",outcome:"counted",depth:2,detail:"2 ready",items:["291","292"],tickets:[{id:"291",title:"first",labels:[]},{id:"292",title:"second",labels:[]}]}] };
describe("durable landing owns a Ticket after its Worker exits", () => {
  it("excludes pending landing even when forge unavailable while other work drains", () => {
    expect(excludeCustodiedQueueItems(queue,[record]).projects[0]).toMatchObject({depth:1,items:["292"],tickets:[{id:"292"}]});
  });
  it("never reimplements a merged Ticket while the forge closure is still propagating", () => {
    expect(excludeCustodiedQueueItems(queue,[{...record,state:"terminal",terminal_outcome:"merged"}]).projects[0]?.items).toEqual(["292"]);
  });
  it("allows a new attempt after an unmerged PR is closed", () => {
    expect(excludeCustodiedQueueItems(queue,[{...record,state:"terminal",terminal_outcome:"closed"}]).projects[0]?.items).toEqual(["291","292"]);
  });
  it("keeps another project's identical Ticket number eligible", () => {
    expect(excludeCustodiedQueueItems(queue,[{...record,project_label:"other/widgets"}])).toEqual(queue);
  });
  it("fails closed when the poll provides only a count", () => {
    const counted={...queue,projects:[{...queue.projects[0]!,items:undefined,tickets:undefined}]};
    expect(excludeCustodiedQueueItems(counted,[record]).projects[0]?.depth).toBe(0);
  });
});

import type { RedskilledGithubRead, RedskilledGithubProjectReader } from "../src/github-gateway.js";
import { describe, expect, it } from "vitest";
import { cascadeMergedTicket } from "../src/github-dependency-cascade.js";
const project={projectId:"github:1",projectLabel:"acme/widgets",workspacePath:"/nonexistent/widgets",credentialProfile:"personal"};
function harness(ownerClosed=true) {
  const writes: unknown[]=[];
  const reader: RedskilledGithubProjectReader={
    async read(request:RedskilledGithubRead) {
      if(request.kind!=="rest") throw new Error("REST only");
      const path=request.path;
      const value=path.includes("?") ? [
        {number:292,body:"",labels:["blocked:dependency","req:291"]},
        {number:300,body:"",labels:["blocked:dependency","req:291","req:299"]},
        {number:301,body:"",labels:["blocked:dependency","req:291","req:other/repo#5"]},
        {number:302,body:"",labels:["blocked:dependency","ready-for-human","req:291"]},
      ] : {state:path.endsWith("/291")&&ownerClosed?"closed":"open"};
      return {version:1,project_id:"github:1",credential_profile:"personal",source:"upstream" as const,cache:{outcome:"miss" as const,fetched_at:"",age_ms:0,fresh_ms:0},budget:null,value};
    },
    async write(request:unknown) {writes.push(request);return {version:1,project_id:"github:1",credential_profile:"personal",idempotency_key:"",state:"published" as const,queued_at:"",published_at:"",value:{}};},
    async resumeWrites(){return[];},
  };
  return {reader,writes};
}
describe("merge closure releases only eligible dependents", () => {
  it("uses the canonical transition for a dependent and keeps its sibling blocked", async () => {
    const h=harness();await cascadeMergedTicket(h.reader,project,291);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[0]).toMatchObject({idempotency_key:"cascade:291:292:labels",write:{kind:"issue-transition",issue:292,add:["ready-for-agent"],remove:expect.arrayContaining(["blocked:dependency","req:291"])}});
  });
  it("does not invent issue closure while it is propagating", async () => {
    const h=harness(false);await expect(cascadeMergedTicket(h.reader,project,291)).rejects.toThrow(/awaiting forge closure/);expect(h.writes).toHaveLength(1);expect(h.writes[0]).toMatchObject({write:{issue:291,close:true}});
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRedskilledGithubCustodyUpstream } from "../src/github-custody-upstream.js";
const SHA = "a".repeat(40);
const input = { project: { projectId: "github:1", projectLabel: "acme/widgets", workspacePath: "/tmp/widgets", credentialProfile: "personal" }, credential: { secret: "fixture" }, pullRequest: 73, armedHead: SHA };
const pull = { state: "open", merged: false, node_id: "PR_73", mergeable: true, mergeable_state: "clean", auto_merge: null, head: { sha: SHA } };
describe("validated merge without repository auto-merge", () => {
  it("normally merges a clean head with GitHub's SHA precondition", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => new Response(JSON.stringify(String(url).includes("/reviews?") ? [] : init?.method === "PUT" ? { merged: true } : pull)));
    const upstream = createRedskilledGithubCustodyUpstream({ fetchImpl });
    await expect(upstream.arm(input)).resolves.toMatchObject({ forge_state: "merged" });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/pulls/73/merge"), expect.objectContaining({ method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: SHA }) }));
  });
  it("does not merge a head that changed between observation and arming", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ...pull, head: { sha: "b".repeat(40) } })));
    const upstream = createRedskilledGithubCustodyUpstream({ fetchImpl });
    await expect(upstream.arm(input)).rejects.toThrow(/validated head/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not directly merge pending or failing checks", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => new Response(JSON.stringify(String(url).endsWith("graphql") ? { errors: [{ message: "Auto-merge disabled" }] } : { ...pull, mergeable_state: "unstable" })));
    const upstream = createRedskilledGithubCustodyUpstream({ fetchImpl });
    await expect(upstream.arm(input)).rejects.toThrow();
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).endsWith("/merge"))).toBe(false);
  });
});

it("blocks a draft even when GitHub describes its head as clean",async()=>{
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({...pull,draft:true})));
  await expect(createRedskilledGithubCustodyUpstream({fetchImpl}).arm(input)).rejects.toThrow(/draft/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("keeps requested changes after advisory comments, allowing only an explicit approval to clear them",async()=>{
  let state="COMMENTED";
  const fetchImpl=vi.fn(async(url:unknown,init?:RequestInit)=>new Response(JSON.stringify(String(url).includes("/reviews?") ? [{user:{login:"reviewer"},state:"CHANGES_REQUESTED"},{user:{login:"reviewer"},state}] : init?.method==="PUT" ? {merged:true} : pull)));
  const upstream=createRedskilledGithubCustodyUpstream({fetchImpl});
  await expect(upstream.arm(input)).rejects.toThrow(/requested changes/);
  expect(fetchImpl.mock.calls.some((call)=>String(call[0]).endsWith("/merge"))).toBe(false);
  state="APPROVED";await expect(upstream.arm(input)).resolves.toMatchObject({forge_state:"merged"});
});

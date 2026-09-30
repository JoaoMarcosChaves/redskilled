import { expect, it, vi } from "vitest";
import { createRedskilledGithubWriteUpstream } from "../src/github-write.js";
import { validateWriteRequest } from "../src/github-outbox.js";
it("publishes a close-only Ticket transition through the durable write contract",async()=>{
  const request=validateWriteRequest({idempotency_key:"merge-close:291",write:{kind:"issue-transition",issue:291,close:true,add:[],remove:[]}});
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({state:"closed"})));
  const write=createRedskilledGithubWriteUpstream({fetchImpl});
  await write({project:{projectId:"github:1",projectLabel:"acme/widgets",workspacePath:"/tmp/widgets",credentialProfile:"personal"},credential:{secret:"fixture"},idempotencyKey:request.idempotency_key,write:request.write});
  expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/repos/acme/widgets/issues/291",expect.objectContaining({method:"PATCH",body:JSON.stringify({state:"closed",state_reason:"completed"})}));
});
it("refuses a reopen or a no-op transition",()=>{
  const malformed:Parameters<typeof validateWriteRequest>[0]={idempotency_key:"k",write:{kind:"issue-transition",issue:291,close:true,add:[],remove:[]}};
  Object.assign(malformed.write,{close:false});
  expect(()=>validateWriteRequest(malformed)).toThrow();
  expect(()=>validateWriteRequest({idempotency_key:"k",write:{kind:"issue-transition",issue:291,add:[],remove:[]}})).toThrow();
});

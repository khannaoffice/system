import { test } from "node:test"
import assert from "node:assert/strict"
import { approve, commit, perform, type Approval, type Receipt } from "../src/operations.ts"
import { invoke } from "../src/capabilities.ts"
import { listRevisions, readObject } from "../src/core.ts"
import { AGENT, makeWorld, OWNER, ok, code } from "./world.ts"

type W = ReturnType<typeof makeWorld>
const preview = (id: string, expectedRevision: string, changes: Record<string, string>) => ({ capability: "ko_preview_change", arguments: { id, expectedRevision, changes } })

async function change(w: W, actor: typeof AGENT | typeof OWNER, id: string, changes: Record<string, string>) {
  const o = w.world.register.objects.find((x) => x.id === id)!
  const staged = ok(await perform(w.world, actor, preview(id, o.revisionId, changes))) as { receipt: Receipt }
  const req = { capability: "ko_commit_change", arguments: { proposalId: (staged.receipt.output as { proposalId: string }).proposalId } }
  const prepared = await perform(w.world, actor, req) as any
  if (prepared.status !== "needs_approval") return prepared
  const a = ok(await approve(w.world, OWNER, prepared.error.details.operationId)) as Approval
  return commit(w.world, actor, req, a.id) as Promise<any>
}

test("a draft is not published: the public sees the old revision until a change is committed", async () => {
  const w = makeWorld()
  w.grant(["revise"])
  const o = w.world.register.objects[0]
  ok(await perform(w.world, AGENT, preview(o.id, o.revisionId, { title: "Drafted title" })))
  const seen = (invoke(w.world.register, { capability: "ko_read_object", arguments: { id: o.id } }) as any).data
  assert.equal(seen.title, o.title, "the draft is not visible")
  assert.equal(seen.revisionId, o.revisionId)
  assert.equal(Object.values(w.world.proposals)[0].status, "draft", "and it is marked a draft, not a revision")
})

test("a committed change is a new revision that follows the old, and the old stays readable", async () => {
  const w = makeWorld()
  w.grant(["revise"])
  const o = w.world.register.objects[0]
  const r = await change(w, AGENT, o.id, { title: "Retitled", summary: "A new line." })
  assert.equal(r.status, "ok")
  const now = (readObject(w.world.register, o.id) as any).data
  assert.equal(now.title, "Retitled")
  assert.equal(now.previousRevisionId, o.revisionId)
  assert.equal(now.id, o.id, "identity survives the change")
  assert.equal((readObject(w.world.register, o.id, { revisionId: o.revisionId }) as any).data.title, o.title, "the earlier revision still reads as it did")
  assert.deepEqual((r.data.receipt as Receipt).before[o.id], o.revisionId)
  assert.deepEqual((r.data.receipt as Receipt).after[o.id], now.revisionId, "the receipt names both revisions")
})

test("authorship is kept honest: an agent's change stays the agent's, a person's stays the person's", async () => {
  const w = makeWorld()
  w.grant(["revise"])
  const [a, b] = w.world.register.objects
  await change(w, AGENT, a.id, { title: "By the agent" })
  await change(w, OWNER, b.id, { title: "By the person" })
  const byAgent = (readObject(w.world.register, a.id) as any).data.provenance
  const byPerson = (readObject(w.world.register, b.id) as any).data.provenance
  assert.equal(byAgent.method, "derived")
  assert.equal(byAgent.recordedBy, AGENT.id)
  assert.match(byAgent.source, /approved by rohan/, "the approval is on the record, the authorship is not transferred")
  assert.deepEqual([byPerson.method, byPerson.recordedBy], ["authored", OWNER.id])
})

test("concurrent changes are detected: the second does not silently overwrite the first", async () => {
  const w = makeWorld()
  w.grant(["revise"])
  const o = w.world.register.objects[0]
  const stagedA = ok(await perform(w.world, AGENT, preview(o.id, o.revisionId, { title: "A's title" }))) as { receipt: Receipt }
  const stagedB = ok(await perform(w.world, OWNER, preview(o.id, o.revisionId, { title: "B's title" }))) as { receipt: Receipt }
  const commitReq = (s: { receipt: Receipt }) => ({ capability: "ko_commit_change", arguments: { proposalId: (s.receipt.output as { proposalId: string }).proposalId } })
  const pA = await perform(w.world, AGENT, commitReq(stagedA)) as any
  const aA = ok(await approve(w.world, OWNER, pA.error.details.operationId)) as Approval
  assert.equal((await commit(w.world, AGENT, commitReq(stagedA), aA.id)).status, "ok")
  const lost = await perform(w.world, OWNER, commitReq(stagedB)) as any
  assert.equal(code(lost), "conflict/stale_revision")
  assert.equal((readObject(w.world.register, o.id) as any).data.title, "A's title", "the first change stands")
  assert.equal(code(await perform(w.world, OWNER, preview(o.id, o.revisionId, { title: "late" })) as any), "conflict/stale_revision")
})

test("a change can be reversed by a compensating revision, and history stays whole", async () => {
  const w = makeWorld()
  w.grant(["revise"])
  const o = w.world.register.objects[0]
  await change(w, AGENT, o.id, { title: "Oops", summary: "Wrong." })
  const changed = (readObject(w.world.register, o.id) as any).data
  const back = await change(w, AGENT, o.id, { title: o.title, ...(o.summary ? { summary: o.summary } : { summary: "" }) })
  assert.equal(back.status, "ok")
  const now = (readObject(w.world.register, o.id) as any).data
  assert.equal(now.title, o.title, "the content is back")
  const chain = (listRevisions(w.world.register, o.id) as any).data
  assert.equal(chain.length, 3, "three revisions, none overwritten")
  assert.equal(new Set(chain.map((r: any) => r.revisionId)).size, 3, "all distinct: restoring is not the original again")
  assert.notEqual(now.revisionId, o.revisionId)
  assert.equal(now.previousRevisionId, changed.revisionId)
  assert.equal((readObject(w.world.register, o.id, { revisionId: o.revisionId }) as any).data.title, o.title)
  assert.equal((readObject(w.world.register, o.id, { revisionId: changed.revisionId }) as any).data.title, "Oops", "the mistake stays on the record")
})

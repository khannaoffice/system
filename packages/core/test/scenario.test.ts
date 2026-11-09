import { test } from "node:test"
import assert from "node:assert/strict"
import { IDBFactory } from "fake-indexeddb"
import { approve, commit, perform, getPosition, type Approval, type Receipt } from "../src/operations.ts"
import { invoke } from "../src/capabilities.ts"
import { listObjects, readCollection, type Collection } from "../src/core.ts"
import { addToGather, createGather } from "../src/gather.ts"
import { locate, describe, type Surface } from "../src/surface.ts"
import { toWebAnnotation } from "../src/annotation.ts"
import { sortBy, ORDERINGS } from "../src/core.ts"
import { handleMessage } from "../../adapters/mcp/src/mcp.ts"
import { idbStore } from "../../state/src/store.ts"
import { personal } from "../../state/src/personal.ts"
import { AGENT, makeWorld, OWNER, ok, code } from "./world.ts"

test("S-29 SPEC 29: a researcher and an agent, from first visit to published collection", async () => {
  const { world, grant, tick } = makeWorld()
  const register = () => world.register
  const factory = new IDBFactory()
  const ask = (name: string, args: Record<string, unknown>) => invoke(register(), { capability: name, arguments: args }) as any

  const kinds = new Set(register().objects.map((o) => o.type))
  assert.ok(["Photograph", "System", "Writing", "Project"].every((k) => kinds.has(k)))

  const human = listObjects(register(), { limit: 200 })
  const machine = (handleMessage(register(), { jsonrpc: "2.0", id: 1, method: "resources/list" }) as any).result.resources
  assert.ok(human.status === "ok" && human.data.total === machine.length, "the same objects, by both routes")

  const grantFor = grant(["collection:write"])
  const humanSurface: Surface = { type: "index", id: "rohankhanna.com/works", anchors: sortBy(register().objects, ORDERINGS["date:desc"]).map((o) => o.id) }
  const humanAt = { surfaceId: humanSurface.id, anchor: humanSurface.anchors[3] }
  ok(await perform(world, OWNER, { capability: "ko_set_position", arguments: { position: humanAt } }))

  const studies = ask("ko_search_objects", { query: "gropius house" }).data.items[0].object
  const system = ask("ko_search_objects", { query: "unigrid", type: "System" }).data.items[0].object
  assert.equal(studies.type, "Photograph")
  assert.equal(system.title, "Unigrid")
  const related = ask("ko_list_relations", { id: ask("ko_search_objects", { query: "unigrid app" }).data.items[0].object.id }).data
  assert.ok(related.some((r: any) => r.provenance.method === "authored"), "it follows typed relations, each saying how it came to be")
  const source = ask("ko_read_object", { id: studies.id }).data
  assert.ok(source.representations.some((r: any) => r.role === "media"), "and reads the supporting material, the photographs themselves")

  ok(await perform(world, AGENT, { capability: "ko_set_position", arguments: { position: { surfaceId: "gallery", anchor: "photo-9" } } }))
  const seize = await perform(world, AGENT, { capability: "ko_set_position", arguments: { participantId: OWNER.id, position: { surfaceId: "gallery", anchor: "photo-1" } } }) as any
  assert.equal(code(seize), "denied/not_permitted", "an agent that tries to take the human's view is refused")
  assert.deepEqual((getPosition(world, OWNER) as any).data.anchor, humanAt.anchor, "the human is where they were")
  assert.equal((world.positions.positions[AGENT.id] as any).anchor, "photo-9", "while the agent's own place is visible and separate")

  const thread = ok(await perform(world, AGENT, { capability: "ko_create_collection", arguments: { title: "Photographic studies and the grid" } })) as { receipt: Receipt }
  const threadId = (thread.receipt.output as { id: string }).id
  ok(await perform(world, AGENT, { capability: "ko_add_to_collection", arguments: { id: threadId, objectIds: [system.id], basis: "evidenced" } }))
  ok(await perform(world, AGENT, { capability: "ko_add_to_collection", arguments: { id: threadId, objectIds: [studies.id] } }))
  const proposed = readCollection(register(), threadId, "owner") as any
  assert.deepEqual(proposed.data.collection.members.map((m: any) => m.basis), ["evidenced", "inferred"], "each member says why it is there")
  assert.equal(proposed.data.collection.provenance.method, "derived", "an agent's thread is never passed off as authored")
  const authored = register().collections.find((c) => c.provenance.method === "authored")!
  assert.notEqual(proposed.data.collection.provenance.method, authored.provenance.method, "and is distinguishable from one a person wrote")

  const first = register().objects.find((o) => o.title === "Layers")!
  assert.ok(![studies.id, system.id].includes(first.id), "three different objects")
  await (async () => {
    const o = first
    const staged = ok(await perform(world, OWNER, { capability: "ko_preview_change", arguments: { id: o.id, expectedRevision: o.revisionId, changes: { summary: "A revised line." } } })) as { receipt: Receipt }
    const req = { capability: "ko_commit_change", arguments: { proposalId: (staged.receipt.output as { proposalId: string }).proposalId } }
    const prep = await perform(world, OWNER, req) as any
    const a = ok(await approve(world, OWNER, prep.error.details.operationId)) as Approval
    ok(await commit(world, OWNER, req, a.id))
  })()
  const now = register().objects.find((o) => o.id === first.id)!
  const diff = ask("ko_compare_revisions", { id: first.id, from: first.revisionId, to: now.revisionId }).data
  assert.deepEqual(diff.changes.map((c: any) => c.field), ["summary"], "the two representations differ in exactly what changed")

  const mine = ok(await perform(world, AGENT, { capability: "ko_create_collection", arguments: { title: "For the paper" } })) as { receipt: Receipt }
  const mineId = (mine.receipt.output as { id: string }).id
  ok(await perform(world, AGENT, { capability: "ko_add_to_collection", arguments: { id: mineId, objectIds: [studies.id, system.id, first.id] } }))
  assert.equal(readCollection(register(), mineId).status, "failed", "it is private: the public cannot see it")

  ok(await perform(world, OWNER, { capability: "ko_reorder_collection", arguments: { id: mineId, objectId: first.id, position: 0 } }))
  const noted = ok(await perform(world, OWNER, { capability: "ko_create_annotation", arguments: { objectId: studies.id, body: "The module shows in the doorframes." } })) as { receipt: Receipt }
  const here = { surfaceId: "gallery:gropius", anchor: "photo-9" }
  const members = (readCollection(register(), mineId, "owner") as any).data.members.map((m: any) => m.objectId)
  assert.equal(members[0], first.id, "the new order holds")
  const p = personal(idbStore("researcher", factory))
  let kept = createGather(mineId, "For the paper")
  for (const id of members) kept = addToGather(kept, { objectId: id, revisionId: register().objects.find((o) => o.id === id)!.revisionId, ...(id === studies.id ? { note: "The module shows in the doorframes." } : {}) })
  await p.gathers.save(kept)
  await p.positions.save(here)

  tick(24 * 3600_000)
  const back = personal(idbStore("researcher", factory))
  const [returned] = await back.gathers.list()
  assert.deepEqual(returned.items.map((i) => i.objectId), members, "the collection, in the researcher's order")
  assert.equal(returned.items.find((i) => i.objectId === studies.id)?.note, "The module shows in the doorframes.")
  const gallery: Surface = { type: "sequence", id: "gallery:gropius", members: Array.from({ length: 18 }, (_, i) => `photo-${i + 1}`) }
  const landing = locate(gallery, (await back.positions.load("gallery:gropius"))!)
  assert.equal(landing.resolution, "exact")
  assert.equal(describe(gallery, landing.position), "9 of 18.", "and where they were, in words")
  const note = world.annotations.find((a) => a.id === (noted.receipt.output as { id: string }).id)!
  assert.ok(toWebAnnotation(note, register(), "owner"), "the note leaves as a W3C annotation")
  assert.equal(toWebAnnotation(note, register(), "public"), null, "and stays private")

  const publishReq = { capability: "ko_publish_collection", arguments: { id: mineId } }
  const lapsed = await perform(world, AGENT, publishReq) as any
  assert.equal(lapsed.error.details.reason, "expired", "yesterday's authority is not today's")
  assert.ok(grantFor.expiresAt <= world.clock())
  grant(["collection:write", "publish"])
  const prepared = await perform(world, AGENT, publishReq) as any
  assert.equal(prepared.status, "needs_approval", JSON.stringify(prepared.error))
  assert.match(prepared.error.details.effects[0], /public, with 3 object\(s\), visible to anyone/, `contents and audience, before anyone says yes: ${prepared.error.details.effects[0]}`)
  assert.equal(readCollection(register(), mineId).status, "failed", "nothing is public yet")

  const approval = ok(await approve(world, OWNER, prepared.error.details.operationId)) as Approval
  const done = ok(await commit(world, AGENT, publishReq, approval.id)) as { receipt: Receipt }
  assert.equal(done.receipt.outcome, "committed")
  assert.equal(done.receipt.principal, OWNER.id)
  assert.equal(done.receipt.actor, AGENT.id)
  assert.equal(done.receipt.approval, approval.id)
  assert.match((done.receipt.output as { revisionId: string }).revisionId, /^sha256:[0-9a-f]{64}$/, "a version of exactly what was published")
  assert.equal(code((await import("../src/operations.ts")).getReceipt(world, OWNER, done.receipt.operationId) as any), "ok")

  const viaMcp = (handleMessage(register(), { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ko_read_thread", arguments: { id: mineId } } }) as any).result
  assert.equal(viaMcp.isError, false)
  const published = viaMcp.structuredContent.data.collection as Collection
  assert.deepEqual([published.kind, published.visibility], ["published", "public"])
  assert.deepEqual(viaMcp.structuredContent.data.members.map((m: any) => m.objectId), members, "the same members, in the same order")
  assert.ok(viaMcp.structuredContent.data.members.every((m: any) => m.state === "available"))
  const viaResource = (handleMessage(register(), { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: `ko://collection/${mineId}` } }) as any).result
  assert.equal(JSON.parse(viaResource.contents[0].text).data.collection.id, mineId)
  assert.equal(readCollection(register(), threadId).status, "failed")
})

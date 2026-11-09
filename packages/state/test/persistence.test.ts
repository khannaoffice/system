import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IDBFactory } from "fake-indexeddb"
import { fileStore } from "../src/filestore.ts"
import { idbStore, memoryStore, type Store } from "../src/store.ts"
import { openWorld, persisted } from "../src/world-store.ts"
import { readCollection } from "../../core/src/core.ts"
import type { Approval, Receipt } from "../../core/src/operations.ts"
import { AGENT, OWNER } from "../../core/test/world.ts"
import { fixture } from "../../core/test/helpers.ts"

const base = fixture()
const NOW = Date.parse("2026-11-04T12:00:00.000Z")
const clock = () => new Date(NOW).toISOString()
let n = 0
const ids = () => `ko-${(++n).toString(36).padStart(10, "0")}`

async function open(store: Store) {
  const opened = await openWorld(store, base, OWNER.id, { clock, ids })
  return { opened, w: persisted(opened) }
}
const grant = (opened: Awaited<ReturnType<typeof open>>["opened"]) =>
  opened.world.grants.push({ id: "grant-1", principal: OWNER.id, actor: AGENT.id, scopes: ["collection:write", "publish", "revise", "annotation:write"], resources: ["*"], grantedAt: clock(), expiresAt: new Date(NOW + 3600_000).toISOString() })

const stores: [string, () => { store: Store; cleanup: () => void }][] = [
  ["a folder of files", () => { const dir = mkdtempSync(join(tmpdir(), "ko-world-")); return { store: fileStore(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) } }],
  ["IndexedDB", () => { const f = new IDBFactory(); return { store: idbStore("w", f), cleanup() {} } }],
]

for (const [name, make] of stores) {
  test(`L-2 ${name}: private collections, receipts, grants and the audit log survive a restart`, async () => {
    const { store, cleanup } = make()
    try {
      const a = await open(store)
      grant(a.opened)
      const created = (await a.w.perform(AGENT, { capability: "ko_create_collection", arguments: { title: "Studies" } })) as any
      const id = created.data.receipt.output.id as string
      await a.w.perform(AGENT, { capability: "ko_add_to_collection", arguments: { id, objectIds: [base.objects[0].id, base.objects[1].id] } })
      await a.w.perform(AGENT, { capability: "ko_create_annotation", arguments: { objectId: base.objects[0].id, body: "a private thought" } })
      await a.w.perform(AGENT, { capability: "ko_set_position", arguments: { position: { surfaceId: "index", anchor: "x" } } })
      await a.w.perform(OWNER, { capability: "ko_create_collection", arguments: { title: "Mine" } })
      const before = JSON.stringify([a.opened.world.receipts, a.opened.world.events, a.opened.world.annotations, a.opened.world.grants])

      const b = await open(store)
      assert.deepEqual(b.opened.recovered, [], "nothing needed recovering")
      assert.equal(JSON.stringify([b.opened.world.receipts, b.opened.world.events, b.opened.world.annotations, b.opened.world.grants]), before, "receipts, the log, notes and grants are as they were")
      const read = readCollection(b.opened.world.register, id, "owner") as any
      assert.equal(read.status, "ok")
      assert.deepEqual(read.data.members.map((m: any) => m.objectId), [base.objects[0].id, base.objects[1].id], "the collection, in order")
      assert.equal(readCollection(b.opened.world.register, id).status, "failed", "and it is still private")
      assert.equal(b.opened.world.register.collections.length, base.collections.length + 2, "both collections, over the published threads")
      assert.equal((b.opened.world.positions.positions[AGENT.id] as any).anchor, "x")
    } finally { cleanup() }
  })

  test(`L-2 ${name}: an approval given before a restart can still be committed after it, once, and a retry replays`, async () => {
    const { store, cleanup } = make()
    try {
      const a = await open(store)
      grant(a.opened)
      const made = (await a.w.perform(AGENT, { capability: "ko_create_collection", arguments: { title: "Pub" } })) as any
      const id = made.data.receipt.output.id as string
      await a.w.perform(AGENT, { capability: "ko_add_to_collection", arguments: { id, objectIds: [base.objects[0].id] } })
      const req = { capability: "ko_publish_collection", arguments: { id } }
      const prepared = (await a.w.perform(AGENT, req)) as any
      const approval = (await a.w.approve(OWNER, prepared.error.details.operationId)) as any
      assert.equal(approval.status, "ok")

      const b = await open(store)
      const done = (await b.w.commit(AGENT, req, (approval.data as Approval).id, { idempotencyKey: "k1" })) as any
      assert.equal(done.status, "ok")
      assert.equal(b.opened.world.register.collections.find((c) => c.id === id)!.visibility, "public")

      const c = await open(store)
      assert.equal(c.opened.world.register.collections.find((x) => x.id === id)!.visibility, "public", "the publication holds")
      const again = (await c.w.commit(AGENT, req, (approval.data as Approval).id, { idempotencyKey: "k1" })) as any
      assert.equal(again.data.replayed, true, "a retry after a restart is recognised, not done twice")
      assert.equal((again.data.receipt as Receipt).id, done.data.receipt.id)
      assert.equal(c.opened.world.events.filter((e) => e.type === "operation.committed" && e.payload.capability === "ko_publish_collection").length, 1)
    } finally { cleanup() }
  })
}

test("L-2 a revision made here survives a restart, and one that no longer follows the published base is set aside, not applied", async () => {
  const store = memoryStore()
  const a = await open(store)
  grant(a.opened)
  const o = base.objects[3]
  const staged = (await a.w.perform(AGENT, { capability: "ko_preview_change", arguments: { id: o.id, expectedRevision: o.revisionId, changes: { title: "Retitled here" } } })) as any
  const req = { capability: "ko_commit_change", arguments: { proposalId: staged.data.receipt.output.proposalId } }
  const prepared = (await a.w.perform(AGENT, req)) as any
  const approval = (await a.w.approve(OWNER, prepared.error.details.operationId)) as any
  assert.equal(((await a.w.commit(AGENT, req, approval.data.id)) as any).status, "ok")

  const b = await open(store)
  assert.equal(b.opened.world.register.objects.find((x) => x.id === o.id)!.title, "Retitled here", "the change is still there")
  assert.equal(b.opened.stale.length, 0)
  assert.ok(b.opened.world.register.revisions[o.revisionId], "and so is the revision it followed")

  const moved = { ...base, objects: base.objects.map((x) => (x.id === o.id ? { ...x, title: "Changed upstream", revisionId: "sha256:" + "7".repeat(64) } : x)) }
  const c = await openWorld(store, moved, OWNER.id, { clock, ids })
  assert.equal(c.world.register.objects.find((x) => x.id === o.id)!.title, "Changed upstream", "published content wins")
  assert.equal(c.stale.length, 1, "the local revision is reported, not silently applied over it")
})

test("L-2 a crash between writing the log and the state is detected, and an unrecorded commit is reported as unknown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-crash-"))
  try {
    const store = fileStore(dir)
    const a = await open(store)
    grant(a.opened)
    await a.opened.save()
    const { perform } = await import("../../core/src/operations.ts")
    await perform(a.opened.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Lost?" } })
    await a.opened.save({ stopAfterLog: true })

    const b = await open(store)
    assert.ok(b.opened.recovered.length >= 1, b.opened.recovered.join(" | "))
    assert.match(b.opened.recovered.join(" "), /newer than the last snapshot/)
    const unknown = Object.values(b.opened.world.operations).filter((o) => o.status === "unknown")
    assert.equal(unknown.length, 1, "the operation the log says happened, with no receipt, is unknown")
    assert.ok(b.opened.recovered.some((r) => /no receipt: its outcome is unknown/.test(r)))
    assert.ok(!b.opened.world.register.collections.some((c) => c.title === "Lost?"), "and the collection is not pretended into existence")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the file store is readable, atomic and holds one event per file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-files-"))
  try {
    const store = fileStore(dir)
    const a = await open(store)
    grant(a.opened)
    await a.w.perform(AGENT, { capability: "ko_create_collection", arguments: { title: "Readable" } })
    const files = readdirSync(dir)
    assert.ok(files.some((f) => f.startsWith("world%3Aevent%3A")), "each event is its own file")
    assert.ok(files.includes("world%3Asnapshot.json"))
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "no half-written file is left behind")
    const text = readFileSync(join(dir, "world%3Asnapshot.json"), "utf8")
    assert.ok(text.includes('"title": "Readable"') && text.endsWith("\n"), "it can be read in a text editor")
    assert.deepEqual((await store.keys("world:event:")).length, (await a.opened.world.events.length))
    await assert.rejects(() => openWorld(store, base, "someone-else"), /belongs to rohan/, "a store belongs to one owner")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("L-2 ids made after a restart never collide with ids made before it (default id generator)", async () => {
  const store = memoryStore()
  const open1 = await openWorld(store, base, OWNER.id, { clock })
  const a = persisted(open1)
  open1.world.grants.push({ id: "grant-1", principal: OWNER.id, actor: AGENT.id, scopes: ["collection:write"], resources: ["*"], grantedAt: clock(), expiresAt: new Date(NOW + 3600_000).toISOString() })
  const first = (await a.perform(AGENT, { capability: "ko_create_collection", arguments: { title: "Before" } })) as any
  const firstId = first.data.receipt.output.id as string

  const open2 = await openWorld(store, base, OWNER.id, { clock })
  const b = persisted(open2)
  const second = (await b.perform(AGENT, { capability: "ko_create_collection", arguments: { title: "After" } })) as any
  const secondId = second.data.receipt.output.id as string

  assert.notEqual(secondId, firstId, "a new collection does not reuse an old id")
  assert.notEqual(second.data.receipt.operationId, first.data.receipt.operationId, "nor a new operation an old one")
  const open3 = await openWorld(store, base, OWNER.id, { clock })
  const titles = open3.world.register.collections.map((c) => c.title)
  assert.ok(titles.includes("Before") && titles.includes("After"), `both survive: ${titles.join(", ")}`)
  assert.equal(Object.keys(open3.world.receipts).length, 2, "and both receipts")
  assert.equal(new Set(open3.world.events.map((e) => e.eventId)).size, open3.world.events.length, "and every event id is distinct")
})

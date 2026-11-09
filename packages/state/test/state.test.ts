import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { IDBFactory } from "fake-indexeddb"
import { idbStore, memoryStore, openStore } from "../src/store.ts"
import { personal } from "../src/personal.ts"
import { addToGather, createGather } from "../../core/src/gather.ts"
import { fixture } from "../../core/test/helpers.ts"

const here = dirname(fileURLToPath(import.meta.url))

for (const [name, make] of [["memory", () => memoryStore()], ["indexeddb", () => idbStore("t", new IDBFactory())]] as const) {
  test(`${name}: the store keeps, lists and removes`, async () => {
    const s = make()
    await s.set("a:1", { n: 1 })
    await s.set("a:2", { n: 2 })
    await s.set("b:1", { n: 3 })
    assert.deepEqual(await s.get("a:2"), { n: 2 })
    assert.equal(await s.get("nope"), undefined)
    assert.deepEqual(await s.keys("a:"), ["a:1", "a:2"])
    await s.delete("a:1")
    assert.deepEqual(await s.keys(), ["a:2", "b:1"])
  })
}

test("a gather and a position survive a reload, on the same device", async () => {
  const factory = new IDBFactory()
  const o = fixture().objects[0]
  const first = personal(idbStore("khannaoffice", factory))
  await first.gathers.save(addToGather(createGather("ko-g1", "Studies"), { objectId: o.id, revisionId: o.revisionId, note: "keep" }))
  await first.positions.save({ surfaceId: "index", anchor: o.id, nearby: ["x"], offset: 40 })

  const after = personal(idbStore("khannaoffice", factory))
  const [gather] = await after.gathers.list()
  assert.equal(gather.title, "Studies")
  assert.equal(gather.visibility, "private")
  assert.equal(gather.items[0].note, "keep")
  assert.deepEqual(await after.positions.load("index"), { surfaceId: "index", anchor: o.id, nearby: ["x"], offset: 40 })
  await after.gathers.remove("ko-g1")
  assert.deepEqual(await personal(idbStore("khannaoffice", factory)).gathers.list(), [])
})

test("personal storage refuses anything that is not private", async () => {
  const p = personal(memoryStore())
  await assert.rejects(() => p.gathers.save({ ...createGather("g", "t"), visibility: "public" } as never), /private/)
})

test("where storage is refused, the reader still gets a working store and is told it is not kept", async () => {
  const opened = await openStore()
  assert.equal(opened.persistent, false)
  await opened.store.set("k", 1)
  assert.equal(await opened.store.get("k"), 1)
})

test("nothing in the state package can transmit data (SPEC 12.2, 19.1)", () => {
  const forbidden = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share)\b|from "node:(http|https|net|dgram)"/
  for (const file of readdirSync(join(here, "..", "src"))) {
    const source = readFileSync(join(here, "..", "src", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    assert.ok(!forbidden.test(source), `${file} contains network code`)
  }
})

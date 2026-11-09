import { test } from "node:test"
import assert from "node:assert/strict"
import { addToGather, createGather, exportGather, moveInGather, noteOnGather, removeFromGather } from "../src/gather.ts"
import { withdraw } from "../src/core.ts"
import { fixture } from "./helpers.ts"

const ref = (i: number) => {
  const o = fixture().objects[i]
  return { objectId: o.id, revisionId: o.revisionId }
}

test("a gather starts private and never changes in place", () => {
  const start = createGather("ko-g1", "Studies")
  assert.equal(start.visibility, "private")
  const next = addToGather(start, ref(0))
  assert.equal(start.items.length, 0, "the original is untouched")
  assert.equal(next.items.length, 1)
})

test("adding, removing, reordering and noting", () => {
  let g = createGather("ko-g1", "Studies")
  for (const i of [0, 1, 2, 3]) g = addToGather(g, ref(i))
  assert.deepEqual(g.items.map((i) => i.objectId), [0, 1, 2, 3].map((i) => ref(i).objectId))
  assert.equal(addToGather(g, ref(1)).items.length, 4, "one reference per object")
  g = moveInGather(g, ref(3).objectId, 0)
  assert.equal(g.items[0].objectId, ref(3).objectId)
  g = removeFromGather(g, ref(1).objectId)
  assert.equal(g.items.length, 3)
  g = noteOnGather(g, ref(0).objectId, "the grid")
  assert.equal(g.items.find((i) => i.objectId === ref(0).objectId)?.note, "the grid")
  assert.equal(noteOnGather(g, ref(0).objectId, undefined).items.find((i) => i.objectId === ref(0).objectId)?.note, undefined)
  assert.equal(moveInGather(g, "ko-unknown", 0), g, "moving what isn't there changes nothing")
  assert.deepEqual(addToGather(createGather("x", "y"), ref(0), 99).items.length, 1, "an out-of-range position is clamped")
})

test("the export reads on its own, and reports what changed or went", () => {
  const register = fixture()
  let g = createGather("ko-g1", "Studies")
  for (const i of [0, 1, 2]) g = addToGather(g, ref(i))
  g = noteOnGather(g, ref(0).objectId, "start here")

  const stale = { ...register, objects: register.objects.map((o, i) => (i === 1 ? { ...o, revisionId: "sha256:" + "0".repeat(64) } : o)) }
  const gone = withdraw(stale, ref(2).objectId, { withdrawnAt: "2026-11-04" })
  const out = exportGather(g, gone)

  assert.equal(out.items.length, 3, "nothing is dropped from the list")
  assert.deepEqual(out.items.map((i) => i.state), ["current", "revised", "unavailable"])
  assert.equal(out.items[0].note, "start here")
  assert.equal(out.items[0].title, register.objects[0].title)
  assert.equal(out.items[0].canonicalUri, register.objects[0].canonicalUri)
  assert.equal(out.scope, register.scope)
  assert.equal(JSON.parse(JSON.stringify(out)).items.length, 3, "it is plain JSON")
})

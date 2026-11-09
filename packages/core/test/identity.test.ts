import { test } from "node:test"
import assert from "node:assert/strict"
import { appendRevision, readCollection, readObject, listRevisions, withdraw, revisionContent, type SystemObject } from "../src/core.ts"
import { fixture } from "./helpers.ts"
import { createHash } from "node:crypto"

const digest = (o: SystemObject) => `sha256:${createHash("sha256").update(revisionContent(o)).digest("hex")}`
const retitled = (o: SystemObject, title: string): SystemObject => {
  const next = { ...o, title, previousRevisionId: o.revisionId }
  return { ...next, revisionId: digest(next) }
}

test("C-24.1-1 an object retains its ID across title changes", () => {
  const register = fixture()
  const before = register.objects[0]
  const after = appendRevision(register, retitled(before, "A new title"))
  const read = readObject(after, before.id)
  assert.equal(read.status, "ok")
  if (read.status === "ok") {
    assert.equal(read.data.id, before.id)
    assert.equal(read.data.title, "A new title")
    assert.notEqual(read.data.revisionId, before.revisionId, "a new title is a new revision")
  }
  assert.equal(after.objects.length, register.objects.length, "a retitle adds no object")
})

test("C-24.1-2 one object can appear in several collections without duplicated identity", () => {
  const register = fixture()
  const shared = register.objects[0].id
  const withTwo = {
    ...register,
    collections: [
      ...register.collections,
      { ...register.collections[0], id: "ko-testcollection1", members: [{ objectId: shared, position: 0 }] },
      { ...register.collections[1], id: "ko-testcollection2", members: [{ objectId: shared, position: 3 }] },
    ],
  }
  const a = readCollection(withTwo, "ko-testcollection1")
  const b = readCollection(withTwo, "ko-testcollection2")
  assert.ok(a.status === "ok" && b.status === "ok")
  if (a.status === "ok" && b.status === "ok") assert.equal(a.data.members[0].objectId, b.data.members[0].objectId)
  assert.equal(withTwo.objects.filter((o) => o.id === shared).length, 1, "the object exists once")
})

test("C-24.1-3 historical revision links resolve after newer revisions are published", () => {
  const register = fixture()
  const first = register.objects[3]
  const second = retitled(first, "Second")
  const third = retitled(second, "Third")
  const after = appendRevision(appendRevision(register, second), third)
  for (const [revision, title] of [[first, first.title], [second, "Second"], [third, "Third"]] as const) {
    const read = readObject(after, first.id, { revisionId: revision.revisionId })
    assert.ok(read.status === "ok", `revision ${revision.revisionId} still resolves`)
    if (read.status === "ok") assert.equal(read.data.title, title)
  }
  const chain = listRevisions(after, first.id)
  assert.ok(chain.status === "ok")
  if (chain.status === "ok") assert.deepEqual(chain.data.map((o) => o.title), ["Third", "Second", first.title])
  const wrongObject = readObject(after, register.objects[4].id, { revisionId: first.revisionId })
  assert.equal(wrongObject.status, "failed", "a revision of one object is not a revision of another")
})

test("C-24.1-4 a withdrawn object reports an explicit state and keeps its identity", () => {
  const register = fixture()
  const gone = register.objects[5]
  const after = withdraw(register, gone.id, { withdrawnAt: "2026-11-04", reason: "test" })
  const read = readObject(after, gone.id)
  assert.equal(read.status, "failed")
  if (read.status === "failed") {
    assert.equal(read.error.code, "withdrawn", "withdrawn, not merely not found")
    assert.equal(read.error.details?.id, gone.id)
  }
  assert.equal(readObject(after, "ko-neverexisted").status === "failed" && (readObject(after, "ko-neverexisted") as { error: { code: string } }).error.code, "not_found")
  const collection = readCollection(after, register.collections.find((c) => c.members.some((m) => m.objectId === gone.id))?.id ?? register.collections[0].id)
  if (collection.status === "ok" && collection.data.collection.members.some((m) => m.objectId === gone.id)) {
    assert.equal(collection.data.members.find((m) => m.objectId === gone.id)?.state, "withdrawn", "a collection reports the gap rather than dropping it")
  }
})

test("a revision's digest ignores its place in the register but not its content or its history", () => {
  const o = fixture().objects[0]
  assert.equal(digest(o), o.revisionId, "the fixture's revisionId is the digest of its content")
  assert.equal(digest({ ...o, sequence: 99 }), o.revisionId, "reordering the register is not a new revision")
  assert.notEqual(digest({ ...o, title: o.title + "!" }), o.revisionId)
  assert.notEqual(digest({ ...o, previousRevisionId: "sha256:" + "1".repeat(64) }), o.revisionId, "the same content after a different history is a different revision")
})

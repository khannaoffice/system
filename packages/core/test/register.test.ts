import { test } from "node:test"
import assert from "node:assert/strict"
import { listObjects, typesIn, MAX_LIMIT, ORDERINGS, type Register, type SystemObject } from "../src/core.ts"
import { fixture, shuffled } from "./helpers.ts"

const ids = (register: Register, query: Parameters<typeof listObjects>[1]) => {
  const result = listObjects(register, query)
  assert.equal(result.status, "ok")
  return result.status === "ok" ? result.data.items.map((o) => o.id) : []
}

test("C-24.2-1 ordering is deterministic across repeated requests and any input order", () => {
  const register = fixture()
  for (const order of Object.keys(ORDERINGS)) {
    const first = ids(register, { order, limit: MAX_LIMIT })
    for (let run = 0; run < 25; run++) {
      assert.deepEqual(ids(register, { order, limit: MAX_LIMIT }), first)
      const reshuffled = { ...register, objects: shuffled(register.objects, run + 1) }
      assert.deepEqual(ids(reshuffled, { order, limit: MAX_LIMIT }), first, `${order}: input order must not matter`)
    }
  }
})

test("C-24.2-2 filtering has stable membership: the kinds partition the whole", () => {
  const register = fixture()
  const all = ids(register, { limit: MAX_LIMIT })
  const parts = typesIn(register).map(({ type, count }) => {
    const part = ids(register, { type, limit: MAX_LIMIT })
    assert.equal(part.length, count, `${type}: the count is the membership`)
    return part
  })
  assert.deepEqual(parts.flat().sort(), [...all].sort(), "every object is in exactly one kind")
  assert.equal(new Set(parts.flat()).size, all.length, "no object is in two kinds")
  assert.deepEqual(ids(register, { type: "NoSuchKind" }), [], "an unknown kind is empty, not an error")
})

test("C-24.2-3 ties resolve by the declared key, authored sequence, in both directions", () => {
  const register = fixture()
  const byDate = new Map<string, SystemObject[]>()
  for (const o of register.objects) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
  const tied = [...byDate.values()].filter((group) => group.length > 1)
  assert.ok(tied.length >= 3, "the fixture holds real ties")
  for (const direction of ["date:desc", "date:asc"]) {
    const order = ids(register, { order: direction, limit: MAX_LIMIT })
    for (const group of tied) {
      const expected = [...group].sort((a, b) => a.sequence - b.sequence).map((o) => o.id)
      assert.deepEqual(order.filter((id) => expected.includes(id)), expected, `${direction}: tied objects keep authored order`)
    }
  }
})

test("C-24.2-5 membership is complete within the declared scope, across every page", () => {
  const register = fixture()
  for (const limit of [1, 4, 7, 50]) {
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const result = listObjects(register, { limit, cursor, order: "date:desc" })
      assert.equal(result.status, "ok")
      if (result.status !== "ok") return
      assert.ok(result.data.items.length <= limit, "a page never exceeds its bound")
      assert.equal(result.data.total, register.objects.length)
      seen.push(...result.data.items.map((o) => o.id))
      cursor = result.data.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    assert.equal(seen.length, register.objects.length, `limit ${limit}: nothing missing`)
    assert.equal(new Set(seen).size, seen.length, `limit ${limit}: nothing repeated`)
    assert.deepEqual(new Set(seen), new Set(register.objects.map((o) => o.id)))
    assert.equal(pages, Math.ceil(register.objects.length / limit))
  }
})

test("queries fail loudly, never as an empty success (SPEC 21.2)", () => {
  const register = fixture()
  for (const bad of [{ order: "colour:asc" }, { limit: 0 }, { limit: MAX_LIMIT + 1 }, { limit: 1.5 }, { cursor: "garbage" }]) {
    const result = listObjects(register, bad)
    assert.equal(result.status, "failed", JSON.stringify(bad))
  }
  const page = listObjects(register, { limit: 2 })
  assert.ok(page.status === "ok" && page.data.nextCursor)
  if (page.status === "ok") {
    const crossed = listObjects(register, { limit: 2, order: "title:asc", cursor: page.data.nextCursor! })
    assert.equal(crossed.status === "failed" && crossed.error.code, "invalid_cursor", "a cursor belongs to its own query")
  }
})

test("visibility: a private object is neither listed nor distinguishable from a missing one", () => {
  const register = fixture()
  const hidden = { ...register, objects: register.objects.map((o, i) => (i === 0 ? { ...o, visibility: "private" as const } : o)) }
  const id = register.objects[0].id
  assert.ok(!ids(hidden, { limit: MAX_LIMIT }).includes(id))
  assert.equal(ids(hidden, { limit: MAX_LIMIT }).length, register.objects.length - 1)
})

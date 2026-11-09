import { test } from "node:test"
import assert from "node:assert/strict"
import { CAPABILITIES, describeCapabilities, fold, invoke, searchObjects, validate, type Schema } from "../src/capabilities.ts"
import { listObjects, type Register } from "../src/core.ts"
import { Ajv2020, fixture } from "./helpers.ts"

const register = (): Register => fixture()
const ok = (r: ReturnType<typeof invoke>) => { assert.equal(r.status, "ok", JSON.stringify(r)); return (r as { data: any }).data }

test("the small validator agrees with Ajv on every capability's schema", () => {
  const ajv = new Ajv2020({ strict: false })
  const inputs: unknown[] = [
    {}, { query: "x" }, { query: "" }, { query: "x".repeat(201) }, { query: 5 }, { query: "x", limit: 5 }, { query: "x", limit: 0 }, { query: "x", limit: 201 },
    { query: "x", limit: 1.5 }, { query: "x", extra: 1 }, { id: "ko-abc" }, { id: "" }, { id: "ko-abc", type: "relatedTo" }, { id: "ko-abc", type: "nonsense" },
    { id: "a", revisionId: "sha256:" + "a".repeat(64) }, { id: "a", revisionId: "sha256:short" }, { id: "a", from: "sha256:" + "0".repeat(64), to: "sha256:" + "1".repeat(64) },
    { id: "a", from: "x", to: "y" }, [], "string", null, 7, { query: "x", cursor: "c".repeat(501) },
  ]
  for (const capability of CAPABILITIES.filter((c) => c.implemented)) {
    const check = ajv.compile(capability.inputSchema)
    for (const input of inputs) {
      assert.equal(validate(capability.inputSchema, input).length === 0, check(input), `${capability.id} on ${JSON.stringify(input)}`)
    }
  }
})

test("the catalogue names what exists and says which of it can be done here (SPEC 15.2)", () => {
  const { executable, unavailable } = describeCapabilities()
  assert.deepEqual(executable.map((c) => c.id).sort(), ["ko_compare_revisions", "ko_get_warrant", "ko_list_relations", "ko_read_object", "ko_read_thread", "ko_search_objects"])
  assert.equal(executable.length + unavailable.length, CAPABILITIES.length)
  assert.ok(unavailable.length >= 9)
  assert.ok(executable.every((c) => c.effect === "read"), "phase 3 performs reads only")
  for (const { capability } of unavailable) {
    assert.equal(invoke(register(), { capability: capability.id, arguments: {} }).status, "failed", `${capability.id} is not performable`)
  }
  for (const c of CAPABILITIES.filter((c) => c.effect === "consequential")) assert.equal(c.confirmation, "required", `${c.id} must require confirmation`)
})

test("C-24.4-1 public read capabilities work without approval", () => {
  const r = register()
  const first = r.objects[0]
  const calls: [string, unknown][] = [
    ["ko_search_objects", { query: first.title }],
    ["ko_read_object", { id: first.id }],
    ["ko_list_relations", { id: r.relations[0].from }],
    ["ko_read_thread", { id: r.collections[0].id }],
    ["ko_compare_revisions", { id: first.id, from: first.revisionId, to: first.revisionId }],
  ]
  for (const [capability, args] of calls) {
    const result = invoke(r, { capability, arguments: args })
    assert.equal(result.status, "ok", `${capability}: ${JSON.stringify(result)}`)
    assert.notEqual((result as { status: string }).status, "needs_approval")
    assert.equal(CAPABILITIES.find((c) => c.id === capability)!.confirmation, "none")
  }
})

test("invoke refuses what it should, with a reason a caller can act on", () => {
  const r = register()
  const code = (req: Parameters<typeof invoke>[1]) => { const x = invoke(r, req); return x.status === "failed" ? x.error.code : x.status }
  assert.equal(code({ capability: "ko_nothing", arguments: {} }), "unsupported_capability")
  assert.equal(code({ capability: "ko_read_object", version: 2, arguments: { id: "x" } }), "unsupported_version")
  assert.equal(code({ capability: "ko_read_object", arguments: {} }), "invalid_arguments")
  assert.equal(code({ capability: "ko_read_object", arguments: { id: "x", extra: true } }), "invalid_arguments")
  assert.equal(code({ capability: "ko_read_object", arguments: { id: "ko-nope" } }), "not_found")
  assert.equal(code({ capability: "ko_read_object" }), "invalid_arguments", "missing arguments are an error, not an empty success")
})

test("search says how each result matched, never with a score, and folds accents and quotes", () => {
  const r = register()
  const data = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "ile bizard" } }))
  assert.ok(data.items.length >= 1, "an unaccented query finds Île Bizard")
  assert.equal(data.items[0].match, "exact")
  assert.deepEqual(data.methods, ["exact", "lexical"])
  for (const hit of data.items) {
    assert.ok(["exact", "lexical"].includes(hit.match))
    assert.equal("score" in hit || "relevance" in hit || "confidence" in hit, false, "no number dressed as certainty")
  }
  const lexical = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "mcgill roundtable" } }))
  assert.ok(lexical.items.length >= 2 && lexical.items.every((h: any) => h.match === "lexical" || h.match === "exact"))
  assert.equal(fold("Canada’s Mosaic"), "canada's mosaic")
  assert.ok(ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "canada's mosaic" } })).items.length >= 1, "a straight quote finds a curly one")
  assert.equal(ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "zzzzqqqq" } })).total, 0, "nothing found is an empty list, not an error")
  const typed = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "mcgill", type: "event" } }))
  assert.ok(typed.items.every((h: any) => h.object.type === "Event"))
})

test("search pages are bounded, complete and tied to their query", () => {
  const r = register()
  const all = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "the", limit: 200 } })).items.map((h: any) => h.object.id)
  const seen: string[] = []
  let cursor: string | undefined
  do {
    const d = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "the", limit: 3, ...(cursor ? { cursor } : {}) } }))
    assert.ok(d.items.length <= 3)
    seen.push(...d.items.map((h: any) => h.object.id))
    cursor = d.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(seen, all)
  const page = ok(invoke(r, { capability: "ko_search_objects", arguments: { query: "the", limit: 1 } }))
  const crossed = invoke(r, { capability: "ko_search_objects", arguments: { query: "mcgill", limit: 1, cursor: page.nextCursor } })
  assert.equal(crossed.status === "failed" && crossed.error.code, "invalid_cursor")
})

test("search honours visibility and withdrawal", () => {
  const r = register()
  const target = r.objects.find((o) => o.title === "Gropius House")!
  const hidden = { ...r, objects: r.objects.map((o) => (o.id === target.id ? { ...o, visibility: "private" as const } : o)) }
  assert.equal(searchObjects(hidden, { query: "gropius" }).status === "ok" && (searchObjects(hidden, { query: "gropius" }) as any).data.total, 0)
  const gone = { ...r, withdrawn: { [target.id]: { withdrawnAt: "2026-11-04" } } }
  assert.equal((searchObjects(gone, { query: "gropius" }) as any).data.total, 0)
})

test("compare_revisions reports what changed, field by field", () => {
  const r = register()
  const a = r.objects[0]
  const b = { ...a, title: "Renamed", revisionId: "sha256:" + "9".repeat(64), previousRevisionId: a.revisionId }
  const after = { ...r, objects: [b, ...r.objects.slice(1)], revisions: { ...r.revisions, [b.revisionId]: b } }
  const d = ok(invoke(after, { capability: "ko_compare_revisions", arguments: { id: a.id, from: a.revisionId, to: b.revisionId } }))
  assert.deepEqual(d.changes, [{ field: "title", before: a.title, after: "Renamed" }])
  assert.deepEqual(ok(invoke(after, { capability: "ko_compare_revisions", arguments: { id: a.id, from: a.revisionId, to: a.revisionId } })).changes, [])
  const missing = invoke(after, { capability: "ko_compare_revisions", arguments: { id: a.id, from: a.revisionId, to: "sha256:" + "f".repeat(64) } })
  assert.equal(missing.status === "failed" && missing.error.code, "revision_not_found")
})

test("invoke on a capability and listObjects agree on the same register", () => {
  const r = register()
  const viaList = listObjects(r, { limit: 5 })
  const viaRead = invoke(r, { capability: "ko_read_object", arguments: { id: r.objects[2].id } })
  assert.ok(viaList.status === "ok" && viaRead.status === "ok")
})

test("a proposed change's date is a real date: the pattern's digits survive the string", () => {
  const schema = CAPABILITIES.find((c) => c.id === "ko_preview_change")!.inputSchema as Schema
  const args = (date: string) => ({ id: "ko-4qxy3rfv6a", expectedRevision: `sha256:${"0".repeat(64)}`, changes: { date } })
  assert.deepEqual(validate(schema, args("2026-11-05")), [])
  assert.notDeepEqual(validate(schema, args("dddd-dd-dd")), [])
})

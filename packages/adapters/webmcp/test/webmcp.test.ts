import { test } from "node:test"
import assert from "node:assert/strict"
import { findModelContext, registerWebMcp, type ModelContextLike, type WebMcpTool } from "../src/webmcp.ts"
import { CAPABILITIES } from "../../../core/src/capabilities.ts"

const implemented = CAPABILITIES.filter((c) => c.implemented)

function stub() {
  const tools = new Map<string, WebMcpTool>()
  const context: ModelContextLike = { registerTool: (t) => { tools.set(t.name, t) }, unregisterTool: (n) => { tools.delete(n) } }
  return { tools, context }
}

test("where the browser has no model context, nothing is registered and nothing throws", () => {
  const r = registerWebMcp(CAPABILITIES, async () => ({}), null)
  assert.deepEqual({ supported: r.supported, registered: r.registered }, { supported: false, registered: [] })
  r.dispose()
  assert.equal(findModelContext({ navigator: {}, document: {} }), null)
})

test("it is found in either place a browser might put it", () => {
  const { context } = stub()
  assert.equal(findModelContext({ navigator: { modelContext: context } }), context)
  assert.equal(findModelContext({ document: { modelContext: context } }), context)
  assert.equal(findModelContext({ navigator: { modelContext: {} } }), null, "an object with no registration methods is not one")
})

test("only capabilities this application performs are registered, with their real schemas", () => {
  const { tools, context } = stub()
  const r = registerWebMcp(CAPABILITIES, async () => ({}), context)
  assert.equal(r.supported, true)
  assert.deepEqual([...tools.keys()].sort(), implemented.map((c) => c.id).sort())
  for (const c of implemented) {
    assert.deepEqual(tools.get(c.id)!.inputSchema, c.inputSchema)
    assert.equal(tools.get(c.id)!.description, c.description)
    assert.equal(tools.get(c.id)!.annotations?.readOnlyHint, true)
  }
  assert.ok(!tools.has("ko_commit_change"))
})

test("a call goes to the operation endpoint, unchanged, and its envelope comes back whole", async () => {
  const { tools, context } = stub()
  const seen: unknown[] = []
  registerWebMcp(CAPABILITIES, async (capability, args) => { seen.push([capability, args]); return capability === "ko_read_object" ? { status: "failed", error: { code: "not_found", message: "x" } } : { status: "ok", data: { n: 1 } } }, context)
  const ok = await tools.get("ko_search_objects")!.execute({ query: "x" })
  assert.deepEqual(seen[0], ["ko_search_objects", { query: "x" }])
  assert.equal(ok.isError, false)
  assert.deepEqual(JSON.parse(ok.content[0].text), { status: "ok", data: { n: 1 } })
  const bad = await tools.get("ko_read_object")!.execute({ id: "nope" })
  assert.equal(bad.isError, true)
  assert.equal((bad.structuredContent as { error: { code: string } }).error.code, "not_found")
})

test("one tool refusing to register does not stop the rest, and dispose removes what was added", () => {
  const { tools, context } = stub()
  let n = 0
  context.registerTool = (t) => { if (n++ === 1) throw new Error("already registered"); tools.set(t.name, t) }
  const r = registerWebMcp(CAPABILITIES, async () => ({}), context)
  assert.equal(r.registered.length, implemented.length - 1)
  assert.equal(tools.size, implemented.length - 1)
  r.dispose()
  assert.equal(tools.size, 0, "obsolete tools do not linger (SPEC 17.4)")
})

test("a browser that only offers provideContext gets the same tools that way", () => {
  let given: WebMcpTool[] = []
  const r = registerWebMcp(CAPABILITIES, async () => ({}), { provideContext: (c) => { given = c.tools } })
  assert.equal(given.length, implemented.length)
  assert.equal(r.registered.length, implemented.length)
  r.dispose()
  assert.equal(given.length, 0)
})

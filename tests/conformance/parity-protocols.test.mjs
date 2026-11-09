import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { invoke, describeCapabilities, CAPABILITIES } from "../../packages/core/src/capabilities.ts"
import { listObjects } from "../../packages/core/src/core.ts"
import { registerWebMcp } from "../../packages/adapters/webmcp/src/webmcp.ts"

const base = process.env.SITE_URL
const skip = base ? false : "set SITE_URL to run against a live site"
const register = JSON.parse(readFileSync(new URL("../../fixtures/rohankhanna/register.json", import.meta.url), "utf8"))
const first = register.objects[0]
const thread = register.collections[1]

const CALLS = [
  ["ko_search_objects", { query: "mcgill" }],
  ["ko_search_objects", { query: "ile bizard", type: "photograph" }],
  ["ko_search_objects", { query: "zzzzqqqq" }],
  ["ko_read_object", { id: first.id }],
  ["ko_read_object", { id: "ko-doesnotexist" }],
  ["ko_list_relations", { id: register.relations[0].from }],
  ["ko_read_thread", { id: thread.id }],
  ["ko_compare_revisions", { id: first.id, from: first.revisionId, to: first.revisionId }],
  ["ko_read_object", { id: 42 }],
]
const reference = (name, args) => invoke(register, { capability: name, arguments: args })

const viaHttp = async (name, args) => (await fetch(new URL(`/api/v1/operations/${name}/`, base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: args }), redirect: "follow" })).json()

test("C-24.5-1 the HTTP API gives the answer the core gives, for every read", { skip }, async () => {
  for (const [name, args] of CALLS) assert.deepEqual(await viaHttp(name, args), reference(name, args), `${name} ${JSON.stringify(args)}`)
  const object = await (await fetch(new URL(`/api/v1/objects/${first.id}/`, base))).json()
  assert.deepEqual(object, reference("ko_read_object", { id: first.id }))
  const page = await (await fetch(new URL("/api/v1/objects/?limit=7&order=title:asc", base))).json()
  assert.deepEqual(page, listObjects(register, { limit: 7, order: "title:asc" }))
  const advertised = (await (await fetch(new URL("/api/v1/capabilities/", base))).json()).data
  assert.deepEqual(advertised.executable.map((c) => c.id).sort(), describeCapabilities().executable.map((c) => c.id).sort())
  assert.ok(advertised.unavailable.length > 0 && advertised.unavailable.every((u) => !advertised.executable.some((e) => e.id === u.capability.id)))
})

test("C-24.5-2 the official MCP client sees the same tools and gets the same answers", { skip }, async () => {
  const client = new Client({ name: "ko-conformance", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("/api/v1/mcp/", base))
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), describeCapabilities().executable.map((c) => c.id).sort())
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read-only`)
    for (const [name, args] of CALLS) {
      const result = await client.callTool({ name, arguments: args })
      assert.deepEqual(result.structuredContent, reference(name, args), `${name} ${JSON.stringify(args)}`)
      assert.equal(result.isError, reference(name, args).status !== "ok")
    }
    const { resources } = await client.listResources()
    assert.equal(resources.length, register.objects.length)
    const read = await client.readResource({ uri: `ko://object/${first.id}` })
    assert.deepEqual(JSON.parse(read.contents[0].text), reference("ko_read_object", { id: first.id }))
    await assert.rejects(() => client.callTool({ name: "ko_commit_change", arguments: {} }), /Unknown tool/)
  } finally {
    await client.close()
  }
})

test("C-24.5-3 the WebMCP adapter, where a browser offers the API, calls through to the same answers", { skip }, async () => {
  const tools = new Map()
  const context = { registerTool: (t) => tools.set(t.name, t), unregisterTool: (n) => tools.delete(n) }
  const registration = registerWebMcp(CAPABILITIES, viaHttp, context)
  assert.equal(registration.supported, true)
  assert.deepEqual([...tools.keys()].sort(), describeCapabilities().executable.map((c) => c.id).sort())
  for (const [name, args] of CALLS) {
    const out = await tools.get(name).execute(args)
    assert.deepEqual(out.structuredContent, reference(name, args), `${name} ${JSON.stringify(args)}`)
    assert.deepEqual(JSON.parse(out.content[0].text), reference(name, args))
  }
  registration.dispose()
  assert.equal(tools.size, 0)
  const none = registerWebMcp(CAPABILITIES, viaHttp, null)
  assert.deepEqual([none.supported, none.registered], [false, []])
})

test("C-24.5-4 the human interface's own data operation returns what the API returns", { skip }, async () => {
  for (const type of [undefined, "Event", "Photograph", "System", "Writing"]) {
    for (const order of ["date:desc", "date:asc", "title:asc", "sequence:asc"]) {
      const q = new URLSearchParams({ order, limit: "200", ...(type ? { type } : {}) })
      const http = await (await fetch(new URL(`/api/v1/objects/?${q}`, base), { redirect: "follow" })).json()
      assert.deepEqual(http, listObjects(register, { type, order, limit: 200 }), `${type ?? "all"} ${order}`)
    }
  }
})

test("the site registers exactly its tools with a browser's model context: the read capabilities and the page tools", { skip }, async () => {
  const { createRequire } = await import("node:module")
  const { join } = await import("node:path")
  const { homedir } = await import("node:os")
  const repo = (process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir())
  const { chromium } = createRequire(join(repo, "package.json"))("playwright")
  const browser = await chromium.launch({ channel: "chrome" })
  try {
    const page = await (await browser.newContext()).newPage()
    await page.addInitScript(() => {
      window.__registered = []
      Object.defineProperty(navigator, "modelContext", { value: { registerTool: (t) => window.__registered.push(t.name), provideContext: (c) => window.__registered.push(...c.tools.map((t) => t.name)) } })
    })
    await page.goto(base + "/works/", { waitUntil: "networkidle" })
    await page.waitForFunction(() => window.__registered.length >= 15, null, { timeout: 10000 })
    const advertised = (await (await fetch(new URL("/api/v1/capabilities/", base))).json()).data
    const capabilities = advertised.executable.filter((c) => c.implemented).map((c) => c.id)
    const pageTools = ["site_list_entries", "site_filter_index", "site_reverse_index", "site_open_entry", "site_open_thread", "site_close_thread", "site_go_back", "site_read_entry", "site_open_link"]
    assert.deepEqual([...(await page.evaluate(() => window.__registered))].sort(), [...capabilities, ...pageTools].sort(), "exactly the read capabilities and the page tools")
  } finally {
    await browser.close()
  }
})

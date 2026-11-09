import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const sources = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => [`${dir}/${f}`, strip(readFileSync(join(root, dir, f), "utf8"))])
const IMPORT = /(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g
const specifiers = (text) => [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2])

const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|navigator\.connection)\b/
const SERVICES = /\b(supabase|firebase|firestore|dynamodb|mongodb|mongoose|postgres|pg-promise|redis|prisma|drizzle|knex|sequelize|auth0|clerk|passport|next-auth|lucia|axios|got|node-fetch|undici)\b/i
const NODE_NET = /^node:(http|https|http2|net|tls|dgram|dns|cluster|worker_threads)$/

const PACKAGES = { "packages/core/src": { nodeAllowed: [] }, "packages/state/src": { nodeAllowed: ["node:fs", "node:path"] }, "packages/adapters/git/src": { nodeAllowed: ["node:child_process", "node:fs", "node:path"] }, "packages/adapters/mcp/src": { nodeAllowed: [] } }

for (const [dir, { nodeAllowed }] of Object.entries(PACKAGES)) {
  test(`L-1 ${dir} has no network, database or auth-provider code or dependency`, () => {
    for (const [file, text] of sources(dir)) {
      assert.ok(!NETWORK.test(text), `${file} reaches for the network`)
      assert.ok(!SERVICES.test(text), `${file} names a hosted service or database`)
      for (const spec of specifiers(text)) {
        if (spec.startsWith(".")) continue
        assert.ok(spec.startsWith("node:"), `${file} imports the package "${spec}": the System has no runtime dependencies`)
        assert.ok(!NODE_NET.test(spec), `${file} imports ${spec}`)
        assert.ok(nodeAllowed.includes(spec), `${file} imports ${spec}, which ${dir} does not need`)
      }
    }
  })
}

test("L-1 the root package declares no runtime dependencies: everything it uses to test is a dev dependency", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.equal(pkg.dependencies, undefined)
  assert.ok(!Object.keys(pkg.devDependencies).some((d) => SERVICES.test(d)), "no service SDK, even for tests")
})

test("L-1 the WebMCP adapter reaches the network only through the function it is handed", () => {
  const [, text] = sources("packages/adapters/webmcp/src")[0]
  assert.ok(!NETWORK.test(text), "it calls what the host gives it, and nothing else")
})

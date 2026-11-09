import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parseConformance, parseAmendment } from "../../scripts/registry.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (p) => readFileSync(join(root, p), "utf8")
const spec = read("spec/SPEC.md")
const registry = JSON.parse(read("tests/conformance/registry.json"))

const AUTHORITY = new Set(["Established", "Proposed", "Experimental"])
const STATUS = new Set(["pending", "passing"])

test("every section of the specification has a status row", () => {
  const sections = [...spec.matchAll(/^## (\d\d)\. (.+)$/gm)].map((m) => m[1])
  const rows = [...read("spec/STATUS.md").matchAll(/^\| (\d\d) \| (.+?) \| (\w+) \| (\d) \|/gm)]
  assert.deepEqual(rows.map((r) => r[1]), sections, "STATUS.md sections must match SPEC.md, in order")
  for (const row of rows) assert.ok(AUTHORITY.has(row[3]), `section ${row[1]}: unknown authority "${row[3]}"`)
})

test("the registry matches section 24 of the specification (no drift)", () => {
  const expected = parseConformance(spec).map(({ id, text, phase }) => ({ id, text, phase }))
  const actual = registry.entries.filter((e) => e.source === "SPEC 24").map(({ id, text, phase }) => ({ id, text, phase }))
  assert.deepEqual(actual, expected, "run `npm run registry` after changing section 24")
  assert.ok(expected.length > 0)
})

test("A1-34.4 every requirement in amendment 0001 is registered before it is implemented", () => {
  const amendment = parseAmendment(read("spec/amendments/0001-intent-cadence-within-refusal.md")).map(({ id, text, phase }) => ({ id, text, phase }))
  const actual = registry.entries.filter((e) => e.source === "Amendment 0001").map(({ id, text, phase }) => ({ id, text, phase }))
  assert.deepEqual(actual, amendment, "run `npm run registry` after changing amendment 0001")
  assert.ok(amendment.length >= 14, `amendment 0001 has ${amendment.length} registered requirements`)
})

test("no requirement claims to pass without a test that exists", () => {
  for (const e of registry.entries) {
    assert.ok(STATUS.has(e.status), `${e.id}: unknown status "${e.status}"`)
    if (e.status === "passing") {
      assert.ok(e.test && existsSync(join(root, e.test)), `${e.id} is marked passing but its test ${e.test} does not exist`)
      assert.ok(read(e.test).includes(e.id), `${e.id} is marked passing but ${e.test} never mentions it`)
    } else {
      assert.equal(e.test, null, `${e.id} is pending but names a test`)
    }
  }
})

test("report: registered requirements by phase", () => {
  const byPhase = new Map()
  for (const e of registry.entries) {
    const cell = byPhase.get(e.phase) ?? { total: 0, passing: 0 }
    cell.total += 1
    if (e.status === "passing") cell.passing += 1
    byPhase.set(e.phase, cell)
  }
  for (const [phase, c] of [...byPhase].sort((a, b) => a[0] - b[0])) {
    console.log(`  phase ${phase}: ${c.passing}/${c.total} passing`)
  }
})

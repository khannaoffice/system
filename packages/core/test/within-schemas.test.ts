import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { diff } from "../src/within.ts"
import { renderLabel, validateLabel, type Label } from "../src/label.ts"
import { Ajv2020, addFormats, fixture, read, root } from "./helpers.ts"

const ajv = new Ajv2020({ strict: true, allErrors: true })
addFormats(ajv)
for (const file of readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(read(`schemas/${file}`))
const check = (name: string) => ajv.getSchema(`urn:khannaoffice:system:v1:schema:${name}`)!

test("the label and move-set schemas compile under Draft 2020-12 in strict mode", () => {
  assert.ok(check("label"))
  assert.ok(check("move-set"))
})

test("A1-34.2 real labels validate against the label schema, and the schema agrees with the validator", () => {
  const good: Label[] = [
    { medium: "Interaction system. TypeScript and CSS, 2026.", paragraphs: ["One.", "Two, with ’ and × in it."] },
    { medium: "X", paragraphs: ["y"] },
  ]
  for (const label of good) {
    assert.ok(check("label")(label), ajv.errorsText(check("label").errors))
    assert.deepEqual(validateLabel(label), [])
  }
  const bad: unknown[] = [
    {}, { medium: "Oil." }, { medium: "Oil.", paragraphs: [] }, { medium: "", paragraphs: ["a"] }, { medium: "two\nlines", paragraphs: ["a"] },
    { medium: " Oil.", paragraphs: ["a"] }, { medium: "Oil.", paragraphs: [""] }, { medium: "Oil.", paragraphs: ["a\n\nb"] },
    { medium: "Oil.", paragraphs: ["a "] }, { medium: "Oil.", paragraphs: [3] }, { medium: "Oil.", paragraphs: ["a"], caption: "x" },
  ]
  for (const label of bad) {
    assert.equal(check("label")(label), false, JSON.stringify(label))
    assert.notEqual(validateLabel(label).length, 0, JSON.stringify(label))
  }
  const rendered = renderLabel(good[0], fixture().objects[0])
  assert.deepEqual(rendered.record["ko:paragraphs"], { "@list": good[0].paragraphs })
})

test("A1-33.2 real move sets validate against the move-set schema", () => {
  const rows = (...ids: string[]) => ids.map((id, i) => ({ id, value: { n: i % 2 } }))
  let seen = new Set<string>()
  const cases = [
    [rows("a", "b", "c", "d"), rows("d", "c", "b", "a", "e")],
    [rows("a", "b", "c"), rows("b", "c")],
    [rows("a", "b"), [{ id: "a", value: { n: 9 } }, { id: "b", value: { n: 1 } }]],
    [rows("a", "b", "c", "d", "e", "f"), rows("f", "a", "b", "c", "d", "e")],
    [[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }]],
  ] as const
  for (const [before, after] of cases) {
    const set = diff([...before], [...after])
    assert.ok(check("move-set")(set), ajv.errorsText(check("move-set").errors))
    for (const c of set.changes) seen.add(c.kind)
  }
  assert.deepEqual([...seen].sort(), ["change", "insert", "move", "remove"], "every kind of change was validated")
  const objects = fixture().objects.map((o) => ({ id: o.id, value: o.type }))
  const set = diff(objects, [...objects].reverse().filter((_, i) => i % 5 !== 0))
  assert.ok(check("move-set")(set), ajv.errorsText(check("move-set").errors))
  for (const bad of [{}, { changes: [{ kind: "move", id: "a", from: 0, to: 1 }] }, { changes: [{ kind: "teleport", id: "a" }] }, { changes: [{ kind: "move", id: "a", from: 0, to: 1, distance: 0 }] }, { changes: [{ kind: "insert", id: "a", to: -1 }] }]) {
    assert.equal(check("move-set")(bad), false, JSON.stringify(bad))
  }
})

test("A1-34.2 the label schema and the label validator agree on random text", () => {
  let s = 7
  const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  const alphabet = ["a", "b", " ", "\n", "\t", "\r", "é", "."]
  const text = () => Array.from({ length: Math.floor(next() * 6) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("")
  let accepted = 0
  for (let i = 0; i < 4000; i++) {
    const label = { medium: text(), paragraphs: Array.from({ length: Math.floor(next() * 3) }, text) }
    const byValidator = validateLabel(label).length === 0
    assert.equal(check("label")(label), byValidator, JSON.stringify(label))
    if (byValidator) accepted++
  }
  assert.ok(accepted > 50, `${accepted} random labels were valid`)
})

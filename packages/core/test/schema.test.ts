import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { listObjects, readObject } from "../src/core.ts"
import { toJsonLd } from "../src/jsonld.ts"
import { Ajv2020, addFormats, fixture, read, root } from "./helpers.ts"

const ajv = new Ajv2020({ strict: true, allErrors: true })
addFormats(ajv)
for (const file of readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(read(`schemas/${file}`))
const check = (name: string) => ajv.getSchema(`urn:khannaoffice:system:v1:schema:${name}`)!

test("every schema compiles under Draft 2020-12 in strict mode", () => {
  for (const name of ["object", "representation", "relation", "collection", "provenance", "claim", "warrant", "operation-request", "operation-result"]) {
    assert.ok(check(name), `schema ${name} is registered`)
  }
})

test("every fixture record validates against its schema", () => {
  const register = fixture()
  for (const o of register.objects) assert.ok(check("object")(o), `${o.id}: ${ajv.errorsText(check("object").errors)}`)
  for (const r of register.relations) assert.ok(check("relation")(r), ajv.errorsText(check("relation").errors))
  for (const c of register.collections) assert.ok(check("collection")(c), ajv.errorsText(check("collection").errors))
})

test("real operation results validate against the operation-result schema", () => {
  const register = fixture()
  const results = [
    listObjects(register, { limit: 3 }),
    readObject(register, register.objects[0].id),
    readObject(register, "ko-nothere"),
    listObjects(register, { limit: 0 }),
  ]
  for (const result of results) assert.ok(check("operation-result")(result), ajv.errorsText(check("operation-result").errors))
})

test("the schemas reject what they should", () => {
  const good = fixture().objects[0]
  const bad = [
    { ...good, id: "not-an-id" },
    { ...good, date: "yesterday" },
    { ...good, representations: [] },
    { ...good, revisionId: "abc" },
    { ...good, visibility: "secret" },
    { ...good, surprise: true },
    (({ title: _t, ...rest }) => rest)(good),
  ]
  for (const o of bad) assert.equal(check("object")(o), false, JSON.stringify(o).slice(0, 80))
})

test("JSON-LD names the thing, its date and its related objects", () => {
  const register = fixture()
  const withRelations = register.objects.find((o) => register.relations.some((r) => r.from === o.id))!
  const ld = toJsonLd(withRelations, register.relations.filter((r) => r.from === withRelations.id), "https://example.test") as Record<string, unknown>
  assert.equal(ld["@type"] === "Event" || ld["@type"] === "Article" || typeof ld["@type"] === "string", true)
  assert.equal(ld.name, withRelations.title)
  assert.equal(ld.url, withRelations.canonicalUri)
  assert.ok(Array.isArray(ld["ko:relatedTo"]) && (ld["ko:relatedTo"] as unknown[]).length > 0)
  assert.equal(ld["ko:provenance"], "authored")
})

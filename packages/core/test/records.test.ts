import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { approve, cancel, commit, perform, type Approval, type Receipt } from "../src/operations.ts"
import { advance, attach, createTask } from "../src/task.ts"
import { CAPABILITIES } from "../src/capabilities.ts"
import { Ajv2020, addFormats, read, root } from "./helpers.ts"
import { AGENT, makeWorld, OWNER, ok } from "./world.ts"

const ajv = new Ajv2020({ strict: true, allErrors: true })
addFormats(ajv)
const FILES = readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".schema.json"))
for (const f of FILES) ajv.addSchema(read(`schemas/${f}`))
const check = (name: string, value: unknown, label = name) => {
  const v = ajv.getSchema(`urn:khannaoffice:system:v1:schema:${name}`)!
  assert.ok(v, `schema ${name} exists`)
  assert.equal(v(value), true, `${label}: ${ajv.errorsText(v.errors)} in ${JSON.stringify(value).slice(0, 160)}`)
}

test("SPEC 22.1: all sixteen required schemas exist", () => {
  const required = ["object", "representation", "relation", "collection", "position", "annotation", "claim", "warrant", "capability", "operation-request", "operation-result", "participant", "grant", "task", "event", "receipt"]
  for (const name of required) {
    assert.ok(FILES.includes(`${name}.schema.json`), `${name}.schema.json`)
    assert.equal(read(`schemas/${name}.schema.json`).$id, `urn:khannaoffice:system:v1:schema:${name}`, `${name}: $id`)
    assert.ok(ajv.getSchema(`urn:khannaoffice:system:v1:schema:${name}`), `${name} is registered under that id`)
  }
})

test("every record a running world produces validates against its schema", async () => {
  const w = makeWorld()
  const g = w.grant(["collection:write", "annotation:write", "publish", "revise"], { origins: ["https://rohankhanna.com"] })
  w.world.grants.push({ ...g, id: "grant-plain", scopes: ["read:private"], origins: undefined })
  const task = createTask(w.world, AGENT, OWNER.id, "Gather and publish")
  const made = ok(await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Studies" } }, { taskId: task.id, origin: "https://rohankhanna.com" })) as { receipt: Receipt }
  const id = (made.receipt.output as { id: string }).id
  attach(w.world, task.id, made.receipt.operationId)
  ok(await perform(w.world, AGENT, { capability: "ko_add_to_collection", arguments: { id, objectIds: [w.world.register.objects[0].id] } }, { origin: "https://rohankhanna.com" }))
  ok(await perform(w.world, AGENT, { capability: "ko_create_annotation", arguments: { objectId: w.world.register.objects[0].id, body: "noted" } }, { origin: "https://rohankhanna.com" }))
  ok(await perform(w.world, AGENT, { capability: "ko_set_position", arguments: { position: { surfaceId: "index", anchor: "a", offset: 3 } } }))
  const req = { capability: "ko_publish_collection", arguments: { id } }
  const prepared = await perform(w.world, AGENT, req, { taskId: task.id, origin: "https://rohankhanna.com" }) as any
  attach(w.world, task.id, prepared.error.details.operationId)
  for (const s of ["discovering", "proposing", "awaiting_approval"] as const) ok(advance(w.world, task.id, s))
  const a = ok(await approve(w.world, OWNER, prepared.error.details.operationId)) as Approval
  ok(await commit(w.world, AGENT, req, a.id, { origin: "https://rohankhanna.com" }))
  const again = await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Another" } }, { origin: "https://evil.example" }) as any
  assert.equal(again.status, "denied")
  const second = ok(await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Third" } }, { origin: "https://rohankhanna.com" })) as { receipt: Receipt }
  const p2 = await perform(w.world, AGENT, { capability: "ko_publish_collection", arguments: { id: (second.receipt.output as { id: string }).id } }, { origin: "https://rohankhanna.com" }) as any
  cancel(w.world, AGENT, p2.error.details.operationId)
  await commit(w.world, AGENT, req, "nope")

  for (const grant of w.world.grants) check("grant", JSON.parse(JSON.stringify(grant)), `grant ${grant.id}`)
  for (const receipt of Object.values(w.world.receipts)) check("receipt", receipt, `receipt ${receipt.id}`)
  assert.ok(Object.keys(w.world.receipts).length >= 5)
  const types = new Set(w.world.events.map((e) => e.type))
  for (const t of ["operation.prepared", "operation.committed", "operation.denied", "operation.cancelled", "approval.granted"]) assert.ok(types.has(t), `the run produced a ${t} event`)
  for (const e of w.world.events) check("event", e, `event ${e.type}`)
  for (const t of Object.values(w.world.tasks)) check("task", t, `task in ${t.state}`)
  for (const a of w.world.annotations) check("annotation", a)
  for (const p of Object.values(w.world.positions.positions)) check("position", p)
  for (const p of [OWNER, AGENT]) check("participant", p)
  for (const c of CAPABILITIES) check("capability", c, `capability ${c.id}`)
  for (const c of w.world.register.collections) check("collection", JSON.parse(JSON.stringify(c)), `collection ${c.title}`)
})

test("the schemas reject what they should", () => {
  const v = (name: string) => ajv.getSchema(`urn:khannaoffice:system:v1:schema:${name}`)!
  assert.equal(v("event")({ eventId: "e", type: "operation.committed", occurredAt: "2026-11-04T12:00:00Z", actorId: "a", resourceIds: [], payload: { arguments: { secret: 1 } }, schemaVersion: "0.1.0" }), false, "an event that carries arguments is refused")
  assert.equal(v("annotation")({ id: "a", objectId: "o", revisionId: "r", body: "x", author: "a", principal: "p", origin: "robot", visibility: "private", createdAt: "2026-11-04T12:00:00Z" }), false, "origin is person, agent or process")
  assert.equal(v("annotation")({ id: "a", objectId: "o", revisionId: "r", body: "x", author: "a", principal: "p", origin: "agent", visibility: "public", createdAt: "2026-11-04T12:00:00Z" }), false, "a stored annotation is private")
  assert.equal(v("grant")({ id: "g", principal: "p", actor: "a", scopes: [], resources: ["*"], grantedAt: "2026-11-04T12:00:00Z", expiresAt: "2026-11-04T13:00:00Z" }), false, "a grant that grants nothing is refused")
  assert.equal(v("receipt")({ id: "r", operationId: "o", capability: "ko_x", version: 1, actor: "a", principal: "p", authorization: { decision: "deny" }, before: {}, after: {}, outcome: "committed", at: "2026-11-04T12:00:00Z" }), false, "a receipt records an allowed operation")
  assert.equal(v("task")({ id: "t", principal: "p", actor: "a", goal: "g", state: "dreaming", operations: [], createdAt: "2026-11-04T12:00:00Z" }), false)
  assert.equal(v("position")({ surfaceId: "s", confidence: 1 }), false)
})

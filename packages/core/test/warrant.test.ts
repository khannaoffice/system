import { test } from "node:test"
import assert from "node:assert/strict"
import { hasFabricatedConfidence, readWarrant, resolveSources, statusFrom, type Claim, type Warrant } from "../src/warrant.ts"
import { appendRevision, withdraw, type Register, type SystemObject } from "../src/core.ts"
import { invoke } from "../src/capabilities.ts"
import { Ajv2020, addFormats, fixture, read, root } from "./helpers.ts"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const author = { method: "authored" as const, recordedBy: "Rohan Khanna" }
const HEX = (c: string) => "sha256:" + c.repeat(64)

function setup() {
  const base: Register = fixture()
  const [paper, figure, other] = base.objects
  const withAnchors = (o: SystemObject, anchors: string[]): SystemObject => ({ ...o, anchors })
  const register: Register = { ...base, objects: [withAnchors(paper, ["intro", "method", "figure-1"]), withAnchors(figure, ["plate-3"]), other, ...base.objects.slice(3)] }
  register.revisions = { ...register.revisions, [register.objects[0].revisionId]: register.objects[0], [register.objects[1].revisionId]: register.objects[1] }
  const claim: Claim = { id: "claim-1", statement: "The frame is a Van de Graaf construction.", subject: paper.id, revisionId: register.objects[0].revisionId, author }
  const warrant = (over: Partial<Warrant> = {}): Warrant => ({
    claimId: claim.id, method: "Compared the drawn construction with the figure.", author, revisionId: register.objects[0].revisionId, limitations: ["One plate."], status: "supported",
    sources: [
      { objectId: paper.id, revisionId: register.objects[0].revisionId, anchor: "figure-1", relation: "supports" },
      { objectId: figure.id, revisionId: register.objects[1].revisionId, anchor: "plate-3", relation: "supports" },
    ], ...over,
  })
  return { register: { ...register, claims: [claim], warrants: [warrant()] } as Register, claim, warrant, paper, figure, other }
}

test("a warrant whose sources all resolve may be supported, and says where each one resolves", () => {
  const { register } = setup()
  const reading = readWarrant(register, "claim-1")!
  assert.deepEqual(reading.sources.map((s) => s.state), ["resolved", "resolved"])
  assert.equal(reading.computed, "supported")
  assert.equal(reading.honest, true)
})

test("evidence is pinned to a revision: revising the source does not move what the claim rested on", () => {
  const { register, paper } = setup()
  const revised: SystemObject = { ...register.objects[0], title: "Renamed", anchors: ["intro"], previousRevisionId: register.objects[0].revisionId, revisionId: HEX("a") }
  const after = appendRevision(register, revised)
  const reading = readWarrant(after, "claim-1")!
  assert.equal(reading.sources[0].state, "resolved", "figure-1 is gone from the current revision but exists in the one relied on")
  assert.equal(after.objects[0].id, paper.id)
  const pointingAtNow = { ...after.warrants![0], sources: [{ objectId: paper.id, revisionId: revised.revisionId, anchor: "figure-1", relation: "supports" as const }] }
  assert.equal(resolveSources(after, pointingAtNow)[0].state, "anchor_missing")
})

test("each way a source can fail to resolve is named, and none can still be 'supported'", () => {
  const { register, warrant, paper, figure } = setup()
  const cases: [string, Warrant, string][] = [
    ["anchor_missing", warrant({ sources: [{ objectId: paper.id, revisionId: register.objects[0].revisionId, anchor: "no-such-anchor", relation: "supports" }] }), "anchor_missing"],
    ["revision_missing", warrant({ sources: [{ objectId: paper.id, revisionId: HEX("f"), anchor: "intro", relation: "supports" }] }), "revision_missing"],
    ["object_missing", warrant({ sources: [{ objectId: "ko-nothere", revisionId: HEX("e"), relation: "supports" }] }), "object_missing"],
  ]
  for (const [name, w, state] of cases) {
    const r = { ...register, warrants: [w] }
    const reading = readWarrant(r, "claim-1")!
    assert.equal(reading.sources[0].state, state, name)
    assert.equal(reading.computed, "incomplete", name)
    assert.equal(reading.honest, false, `${name}: declared "supported" outruns the evidence`)
  }
  const gone = withdraw({ ...register, warrants: [warrant({ sources: [{ objectId: figure.id, revisionId: register.objects[1].revisionId, relation: "supports" }] })] }, figure.id, { withdrawnAt: "2026-11-04" })
  assert.equal(readWarrant(gone, "claim-1")!.sources[0].state, "withdrawn")
  assert.equal(readWarrant(gone, "claim-1")!.honest, false)
})

test("contested, unverified and incomplete are told apart, and underclaiming is allowed", () => {
  const { register, warrant, paper } = setup()
  const contested = warrant({ status: "contested", sources: [
    { objectId: paper.id, revisionId: register.objects[0].revisionId, anchor: "intro", relation: "supports" },
    { objectId: paper.id, revisionId: register.objects[0].revisionId, anchor: "method", relation: "contradicts" },
  ] })
  const r1 = readWarrant({ ...register, warrants: [contested] }, "claim-1")!
  assert.equal(r1.computed, "contested")
  assert.equal(r1.honest, true)
  const none = readWarrant({ ...register, warrants: [warrant({ status: "unverified", sources: [] })] }, "claim-1")!
  assert.equal(none.computed, "unverified")
  assert.equal(none.honest, true)
  assert.equal(readWarrant({ ...register, warrants: [warrant({ status: "supported", sources: [] })] }, "claim-1")!.honest, false, "supported by nothing is not supported")
  assert.equal(readWarrant(register, "claim-1")!.honest, true)
  assert.equal(readWarrant({ ...register, warrants: [warrant({ status: "unverified" })] }, "claim-1")!.honest, true, "saying less than the evidence shows is honest")
  assert.equal(statusFrom([]), "unverified")
  assert.equal(readWarrant(register, "claim-none"), null)
})

test("a warrant has no confidence number, in the type or the schema", () => {
  const { warrant } = setup()
  const ajv = new Ajv2020({ strict: true })
  addFormats(ajv)
  for (const file of readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(read(`schemas/${file}`))
  const check = ajv.getSchema("urn:khannaoffice:system:v1:schema:warrant")!
  assert.equal(check(warrant()), true, ajv.errorsText(check.errors))
  for (const k of ["confidence", "probability", "score", "certainty", "likelihood"]) {
    assert.equal(check({ ...warrant(), [k]: 0.93 }), false, `${k} is refused`)
    assert.equal(hasFabricatedConfidence({ ...warrant(), [k]: 0.93 }), true)
  }
  assert.equal(hasFabricatedConfidence(warrant()), false)
  assert.equal(check({ ...warrant(), status: "probably" }), false, "four words, no others")
  const claim = ajv.getSchema("urn:khannaoffice:system:v1:schema:claim")!
  assert.equal(claim({ id: "c", statement: "s", subject: "ko-x", revisionId: HEX("a"), author }), true)
})

test("an agent can read a warrant through the same door as everything else", () => {
  const { register } = setup()
  const r = invoke(register, { capability: "ko_get_warrant", arguments: { claimId: "claim-1" } }) as any
  assert.equal(r.status, "ok")
  assert.equal(r.data.computed, "supported")
  assert.equal("confidence" in r.data || "score" in r.data, false)
  assert.equal((invoke(register, { capability: "ko_get_warrant", arguments: { claimId: "nope" } }) as any).error.code, "not_found")
  assert.equal((invoke(register, { capability: "ko_get_warrant", arguments: {} }) as any).error.code, "invalid_arguments")
})

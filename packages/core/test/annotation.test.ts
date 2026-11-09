import { test } from "node:test"
import assert from "node:assert/strict"
import { selectorFor, toAnnotationCollection, toWebAnnotation, ANNOTATION_CONTEXT, type Target } from "../src/annotation.ts"
import type { Annotation } from "../src/operations.ts"
import { fixture } from "./helpers.ts"

const register = fixture()
const o = register.objects[0]
const note = (over: Partial<Annotation> = {}): Annotation => ({ id: "ko-note1", objectId: o.id, revisionId: o.revisionId, body: "Look at the margin.", author: "rohan", principal: "rohan", origin: "person", visibility: "private", createdAt: "2026-11-04T12:00:00.000Z", ...over })

test("an annotation is a W3C Web Annotation: type, id, creator, body and a target with a source", () => {
  const a = toWebAnnotation(note(), register, "owner", { kind: "object" }, "https://x.test") as any
  assert.equal(a["@context"], ANNOTATION_CONTEXT)
  assert.equal(a.type, "Annotation")
  assert.equal(a.id, "https://x.test/annotations/ko-note1")
  assert.deepEqual(a.body, { type: "TextualBody", value: "Look at the margin.", format: "text/plain" })
  assert.equal(a.target.source, o.canonicalUri)
  assert.equal(a.target["ko:revisionId"], o.revisionId, "it keeps pointing at the revision that was read")
  assert.equal(a.creator.type, "Person")
  assert.equal("selector" in a.target, false, "a whole-object target has no selector")
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(a)))
})

test("every kind of target maps onto the standard's selectors", () => {
  const cases: [Target, Record<string, unknown> | null][] = [
    [{ kind: "object" }, null],
    [{ kind: "revision" }, null],
    [{ kind: "anchor", anchor: "figure-1" }, { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/html/", value: "figure-1" }],
    [{ kind: "text", anchor: "intro", start: 4, end: 40 }, { type: "TextPositionSelector", start: 4, end: 40 }],
    [{ kind: "text", anchor: "intro", start: 4, end: 9, exact: "frame" }, { type: "TextPositionSelector", start: 4, end: 9, refinedBy: { type: "TextQuoteSelector", exact: "frame" } }],
    [{ kind: "region", x: 10, y: 20, w: 30, h: 40 }, { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: "xywh=pixel:10,20,30,40" }],
    [{ kind: "region", x: 1, y: 2, w: 3, h: 4, unit: "percent" }, { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: "xywh=percent:1,2,3,4" }],
    [{ kind: "time", start: 12.5, end: 30 }, { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: "t=12.5,30" }],
    [{ kind: "time", start: 5 }, { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: "t=5" }],
    [{ kind: "place", lat: 45.5, lon: -73.6 }, { type: "FragmentSelector", conformsTo: "http://tools.ietf.org/rfc/rfc5870", value: "geo:45.5,-73.6" }],
  ]
  for (const [target, expected] of cases) assert.deepEqual(selectorFor(target), expected, JSON.stringify(target))
  const a = toWebAnnotation(note(), register, "owner", { kind: "time", start: 1, end: 2 }) as any
  assert.equal(a.target.selector.value, "t=1,2")
})

test("a private note is exported only to someone who may see it", () => {
  assert.equal(toWebAnnotation(note(), register, "public"), null)
  assert.ok(toWebAnnotation(note(), register, "owner"))
  const mixed = [note({ id: "a" }), note({ id: "b" })]
  const asPublic = toAnnotationCollection(mixed, register, "public")
  assert.deepEqual([asPublic.type, asPublic.total, asPublic.items.length], ["AnnotationCollection", 0, 0])
  assert.equal(toAnnotationCollection(mixed, register, "owner").total, 2)
  assert.equal(toWebAnnotation(note({ objectId: "ko-gone" }), register, "owner"), null, "a note on nothing is not exported")
})

test("work an agent wrote is credited to the agent, with the person it acted for named", () => {
  const byAgent = toWebAnnotation(note({ author: "agent-1", principal: "rohan", origin: "agent" }), register, "owner") as any
  assert.equal(byAgent.creator.type, "Software")
  assert.equal(byAgent.creator.id, "urn:khannaoffice:participant:agent-1")
  assert.equal(byAgent["ko:onBehalfOf"], "urn:khannaoffice:participant:rohan")
  assert.equal(byAgent["ko:origin"], "agent")
  const byPerson = toWebAnnotation(note(), register, "owner") as any
  assert.equal("ko:onBehalfOf" in byPerson, false)
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { IDBFactory } from "fake-indexeddb"
import { describe, locate, targetKindFor, type Landing, type Surface } from "../src/surface.ts"
import { positionFromQuery, positionToQuery, type Position } from "../src/position.ts"
import { selectorFor, toWebAnnotation, type Target } from "../src/annotation.ts"
import { addToGather, createGather, exportGather } from "../src/gather.ts"
import { sortBy, ORDERINGS } from "../src/core.ts"
import { idbStore } from "../../state/src/store.ts"
import { personal } from "../../state/src/personal.ts"
import { fixture, read } from "./helpers.ts"
import type { Annotation } from "../src/operations.ts"

const register = fixture()
const films = read("fixtures/rohankhanna/durations.json") as Record<string, { href: string; seconds: number; title: string }>
const series = read("fixtures/rohankhanna/images.json") as Record<string, { title: string; photos: { id: string; width: number; height: number }[] }>

const indexOrder = sortBy(register.objects, ORDERINGS["date:desc"]).map((o) => o.id)
const INDEX: Surface = { type: "index", id: "rohankhanna.com/works", anchors: indexOrder, label: "Index, newest first" }
const [galleryId, gallery] = Object.entries(series)[0]
const GALLERY: Surface = { type: "sequence", id: `gallery:${galleryId}`, members: gallery.photos.map((p) => p.id) }
const PHOTO: Surface = { type: "image", id: `image:${gallery.photos[0].id}`, width: gallery.photos[0].width, height: gallery.photos[0].height }
const [filmId, film] = Object.entries(films)[0]
const FILM: Surface = { type: "time", id: `film:${filmId}`, duration: film.seconds }
const CHAPTERED: Surface = { type: "time", id: "film:chaptered-fixture", duration: 120, chapters: [{ id: "c1", start: 0, title: "Opening" }, { id: "c2", start: 40, title: "Middle" }, { id: "c3", start: 90, title: "End" }] }
const MAP: Surface = { type: "map", id: "map:synthetic-montreal", bounds: { south: 45.4, west: -73.9, north: 45.7, east: -73.4 }, minZoom: 8, maxZoom: 18 }

interface Case { name: string; surface: Surface; good: Position; bad: Position[] }
const here = (surface: Surface, rest: Partial<Position>): Position => ({ surfaceId: surface.id, ...rest })
const CASES: Case[] = [
  { name: "index", surface: INDEX, good: here(INDEX, { anchor: indexOrder[5], nearby: [indexOrder[4], indexOrder[6]] }), bad: [here(INDEX, { anchor: "ko-gone", nearby: ["ko-alsogone"] }), here(INDEX, { anchor: "ko-gone", nearby: [indexOrder[2]] })] },
  { name: "sequence (18 photographs)", surface: GALLERY, good: here(GALLERY, { anchor: GALLERY.type === "sequence" ? GALLERY.members[7] : "" }), bad: [here(GALLERY, { anchor: "removed-photo", offset: 5 }), here(GALLERY, { anchor: "removed-photo" }), here(GALLERY, { anchor: "removed-photo", offset: 999 })] },
  { name: "image", surface: PHOTO, good: here(PHOTO, { viewState: { x: 100, y: 100, w: 400, h: 300 } }), bad: [here(PHOTO, { viewState: { x: 1300, y: 900, w: 400, h: 300 } }), here(PHOTO, { viewState: { x: 5000, y: 5000, w: 10, h: 10 } }), here(PHOTO, { viewState: { x: -50, y: 0, w: 0, h: 10 } })] },
  { name: "film (real duration)", surface: FILM, good: here(FILM, { axis: "time", offset: 12.5 }), bad: [here(FILM, { axis: "time", offset: 9999 }), here(FILM, { axis: "time", offset: -3 })] },
  { name: "film with chapters", surface: CHAPTERED, good: here(CHAPTERED, { anchor: "c2" }), bad: [here(CHAPTERED, { anchor: "c9", offset: 55 }), here(CHAPTERED, { anchor: "c9" })] },
  { name: "map", surface: MAP, good: here(MAP, { viewState: { lat: 45.5, lon: -73.6, zoom: 12 } }), bad: [here(MAP, { viewState: { lat: 51, lon: -73.6, zoom: 12 } }), here(MAP, { viewState: { lat: 45.5, lon: -73.6, zoom: 40 } })] },
]

test("the three environments are real: every object in the register, 18 photographs of a known size, films with measured durations", () => {
  assert.equal(indexOrder.length, register.objects.length)
  assert.ok(indexOrder.length >= 33)
  assert.equal(gallery.photos.length, 18)
  assert.ok(PHOTO.type === "image" && PHOTO.width === 1440 && PHOTO.height === 960)
  assert.ok(Object.keys(films).length >= 3 && FILM.type === "time" && FILM.duration > 5, `${film.title} runs ${film.seconds}s`)
})

for (const c of CASES) {
  test(`${c.name}: a saved place lands exactly, and every way of not landing says so`, () => {
    const exact = locate(c.surface, c.good)
    assert.equal(exact.resolution, "exact", JSON.stringify(exact))
    for (const bad of c.bad) {
      const landing = locate(c.surface, bad)
      assert.notEqual(landing.resolution, "exact", `${JSON.stringify(bad)} cannot land exactly`)
      const l = landing as Exclude<Landing, { resolution: "exact" }>
      assert.ok(l.reason.length > 10, "and it says why")
      assert.ok(l.requested.length > 0, "and what it was asked for")
      assert.equal(locate(c.surface, landing.position).resolution, "exact", `the landing is itself valid (${JSON.stringify(landing.position)})`)
    }
  })

  test(`${c.name}: it can be said in words, shared in an address, and annotated`, () => {
    const words = describe(c.surface, c.good)
    assert.ok(words.length > 3 && words.endsWith("."), words)
    assert.equal(describe(c.surface, { ...c.good, surfaceId: "elsewhere" }), "Not on this surface.")
    const kind = targetKindFor(c.surface)
    const target: Target =
      kind === "anchor" ? { kind, anchor: c.good.anchor ?? "x" } : kind === "sequence" ? { kind, member: c.good.anchor ?? "x" } : kind === "time" ? { kind, start: 1, end: 2 } : kind === "region" ? { kind, x: 1, y: 2, w: 3, h: 4 } : { kind, lat: 45.5, lon: -73.6 }
    assert.ok(selectorFor(target), `${kind} has a W3C selector`)
    const query = positionToQuery(c.good)
    assert.equal(positionFromQuery(c.surface.id, query).anchor, c.good.anchor, "an anchor survives the address")
    for (const secret of ["viewState", "selection"]) assert.ok(!query.includes(secret))
  })
}

test("what each surface says in words", () => {
  assert.equal(describe(GALLERY, here(GALLERY, { anchor: (GALLERY as any).members[2] })), "3 of 18.")
  assert.equal(describe(FILM, here(FILM, { offset: 12.5 })), `0:12 of 0:${Math.floor((FILM as any).duration)}.`)
  assert.equal(describe(CHAPTERED, here(CHAPTERED, { offset: 95 })), "1:35 of 2:00, in End.")
  assert.equal(describe(MAP, here(MAP, { viewState: { lat: 45.5, lon: -73.6, zoom: 12 } })), "45.50°N, 73.60°W, zoom 12.")
  assert.equal(describe(PHOTO, here(PHOTO, { viewState: { x: 10, y: 20, w: 30, h: 40 } })), "A region 30 by 40, at 10, 20, of 1440 by 960.")
  assert.equal(describe(PHOTO, here(PHOTO, {})), "The whole image, 1440 by 960.")
  assert.match(describe(INDEX, here(INDEX, { anchor: indexOrder[4] })), new RegExp(`item 5 of ${indexOrder.length}`))
  assert.equal(describe({ type: "document", id: "d", anchors: [] }, { surfaceId: "d" }), "At the start.")
})

test("specific behaviours: a gone chapter lands at the time it was at; a region that ran off is moved to fit; the sequence keeps its place", () => {
  const chapter = locate(CHAPTERED, here(CHAPTERED, { anchor: "c9", offset: 55 }))
  assert.equal(chapter.resolution, "nearby")
  assert.equal(chapter.position.offset, 55, "by time, not by guessing a chapter")
  const ran = locate(PHOTO, here(PHOTO, { viewState: { x: 1300, y: 900, w: 400, h: 300 } }))
  assert.equal(ran.resolution, "nearby")
  assert.deepEqual([ran.position.viewState!.x, ran.position.viewState!.y], [1040, 660], "the same size, moved inside the image")
  const off = locate(PHOTO, here(PHOTO, { viewState: { x: 5000, y: 5000, w: 10, h: 10 } }))
  assert.equal(off.resolution, "fallback", "a region on nothing shows the whole image, and says so")
  const slot = locate(GALLERY, here(GALLERY, { anchor: "removed-photo", offset: 5 }))
  assert.equal(slot.resolution, "nearby")
  assert.equal(slot.position.offset, 5, "the member now at its place")
  assert.equal(locate(FILM, here(FILM, { offset: 9999 })).position.offset, (FILM as any).duration, "past the end lands on the end, as a fallback")
  assert.equal(locate(MAP, here(MAP, { viewState: { lat: 51, lon: -73.6, zoom: 12 } })).resolution, "fallback")
  const foreign = locate(INDEX, { surfaceId: "something-else", anchor: indexOrder[0] })
  assert.equal(foreign.resolution, "fallback")
  assert.equal(foreign.position.surfaceId, INDEX.id, "and it lands on this surface, not the other")
  assert.equal(locate(GALLERY, { surfaceId: "another-gallery", anchor: (GALLERY as any).members[3] }).resolution, "fallback")
  assert.equal(locate(FILM, { surfaceId: "another-film", offset: 5 }).resolution, "fallback")
  assert.equal(locate(MAP, { surfaceId: "another-map", viewState: { lat: 45.5, lon: -73.6, zoom: 12 } }).resolution, "fallback")
})

test("the same primitives work in every environment: gather, annotate, export, persist, return", async () => {
  const factory = new IDBFactory()
  const p = personal(idbStore("env", factory))
  const objects = [register.objects.find((o) => o.type === "Event")!, register.objects.find((o) => o.title === "Gropius House")!, register.objects.find((o) => o.id === filmId)!]
  let g = createGather("ko-envs", "One from each")
  for (const o of objects) g = addToGather(g, { objectId: o.id, revisionId: o.revisionId })
  await p.gathers.save(g)
  for (const c of CASES) await p.positions.save(c.good)

  const back = personal(idbStore("env", factory))
  const [kept] = await back.gathers.list()
  const exported = exportGather(kept, register)
  assert.deepEqual(exported.items.map((i) => i.state), ["current", "current", "current"])
  assert.equal(new Set(exported.items.map((i) => i.objectId)).size, 3, "three different objects, one from each environment")
  for (const c of CASES) {
    const saved = (await back.positions.load(c.surface.id))!
    assert.equal(locate(c.surface, saved).resolution, "exact", `${c.name}: returns to where it was`)
  }
  const note = (objectId: string): Annotation => ({ id: "ko-n", objectId, revisionId: register.objects.find((o) => o.id === objectId)!.revisionId, body: "noted", author: "rohan", principal: "rohan", origin: "person", visibility: "private", createdAt: "2026-11-04T12:00:00.000Z" })
  const at = toWebAnnotation(note(filmId), register, "owner", { kind: "time", start: 12.5, end: 14 }) as any
  assert.equal(at.target.selector.value, "t=12.5,14")
  const region = toWebAnnotation(note(register.objects[0].id), register, "owner", { kind: "region", x: 100, y: 100, w: 400, h: 300 }) as any
  assert.equal(region.target.selector.value, "xywh=pixel:100,100,400,300")
})

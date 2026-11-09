import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CSS_EASINGS, cadence, checkMotion, cubicBezier, informationLost, motionTypesThatDoNotRest, nearestMultiple, parseEasing,
  reduceMotion, restStatus,
  type DeclaredMotion, type MotionType, type PlannedMotion, type State, type Surface, type Value,
  parseSteps,
} from "../src/cadence.ts"
import { shuffled } from "./helpers.ts"

const SITE_EASE = "cubic-bezier(0.22, 0.61, 0.21, 1)"
const SITE: DeclaredMotion[] = [
  { name: "--travel", ms: 620, easing: SITE_EASE },
  { name: "zoom --travel", ms: 380, easing: SITE_EASE },
  { name: "zoom --follow", ms: 240, easing: SITE_EASE },
  { name: "zoom --leave", ms: 110, easing: "ease-in" },
  { name: "agent-line opacity", ms: 500, easing: SITE_EASE },
  { name: "agent-in", ms: 240, easing: SITE_EASE },
  { name: "ledger li opacity", ms: 240, easing: "ease-out" },
  { name: "--ledger-travel", ms: 420 },
  { name: "rule-out", ms: 160, easing: "ease-out" },
  { name: "rule-in", ms: 220, delayMs: 140, easing: "ease-out" },
  { name: "ledger new", ms: 380 },
  { name: "reveal opacity", ms: 420, delayMs: 60, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  { name: "reveal transform", ms: 520, delayMs: 60, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  { name: "mascot opacity", ms: 200, easing: "ease-out" },
  { name: "mascot transform", ms: 420, easing: SITE_EASE },
  { name: "mascot-roll", ms: 3200, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  { name: "layered fill", ms: 240, easing: SITE_EASE },
]
const siteEasings = { standard: parseEasing(SITE_EASE)! }

test("A1-32.1 durations, ticks and pulses are whole multiples of the one base", () => {
  const c = cadence(20, siteEasings)
  assert.equal(c.baseMs, 20)
  for (const n of [0, 1, 3, 31, 160]) {
    assert.equal(c.duration(n), 20 * n)
    assert.equal(c.tick(n), 20 * n)
    assert.equal(c.pulse(n), 20 * n)
  }
  assert.equal(c.duration(31), 620)
})

test("A1-32.1 there is no way to get a duration that is not a multiple of the base", () => {
  const c = cadence(20, siteEasings)
  for (const bad of [0.5, 1.5, -1, NaN, Infinity]) {
    assert.throws(() => c.duration(bad), RangeError, `duration(${bad})`)
    assert.throws(() => c.tick(bad), RangeError)
    assert.throws(() => c.pulse(bad), RangeError)
  }
  assert.throws(() => cadence(0, siteEasings), RangeError)
  assert.throws(() => cadence(-5, siteEasings), RangeError)
  assert.throws(() => cadence(NaN, siteEasings), RangeError)
})

test("A1-32.1 easings are named cubic-bezier control points, and only declared ones can be used", () => {
  const c = cadence(20, { ...siteEasings, out: CSS_EASINGS["ease-out"] })
  assert.equal(c.easing("standard"), "cubic-bezier(0.22, 0.61, 0.21, 1)")
  assert.equal(c.easing("out"), cubicBezier([0, 0, 0.58, 1]))
  assert.throws(() => c.easing("bounce"), RangeError)
  assert.throws(() => cadence(20, { bad: [0.5, 0, 2, 1] }), RangeError, "x values outside 0..1 are not a cubic-bezier")
  assert.deepEqual(parseEasing("ease-out"), [0, 0, 0.58, 1])
  assert.deepEqual(parseEasing("CUBIC-BEZIER( 0.1 , 0.2,0.3 , 0.4 )"), [0.1, 0.2, 0.3, 0.4])
  assert.equal(parseEasing("var(--ease)"), null)
  assert.equal(parseEasing("cubic-bezier(1, 2, 3)"), null)
})

test("A1-32.1 the checker reports the site's stray values for a declared base of its --travel (620 ms)", () => {
  const c = cadence(620, siteEasings)
  const strays = checkMotion(c, SITE)
  const ms = (name: string) => strays.filter((s) => s.name === name && s.field === "ms").map((s) => s.value)
  for (const stray of [380, 240, 500, 160]) assert.ok(strays.some((s) => s.field === "ms" && s.value === stray && s.reason === "not-a-multiple"), `${stray} ms is reported`)
  assert.deepEqual(ms("--travel"), [], "620 itself is the base and is not a stray")
  assert.ok(strays.some((s) => s.field === "easing" && s.value === "ease-out" && s.reason === "undeclared-easing"), "ease-out is reported")
  assert.ok(strays.some((s) => s.field === "easing" && s.value === "cubic-bezier(0.25, 0.1, 0.25, 1)"))
  assert.equal(strays.some((s) => s.field === "easing" && s.value === SITE_EASE), false, "the declared easing is not")
  for (const delay of [140, 60]) assert.ok(strays.some((s) => s.field === "delayMs" && s.value === delay), `the ${delay} ms delay is reported`)
  const s380 = strays.find((s) => s.value === 380)!
  assert.equal(s380.nearestMs, 620)
})

test("A1-32.1 with a base of 20 ms the only duration the site cannot derive is 110 ms, and it is within 10 percent of one", () => {
  const c = cadence(20, siteEasings)
  const strays = checkMotion(c, SITE).filter((s) => s.field !== "easing")
  assert.deepEqual(strays.map((s) => s.value), [110])
  assert.ok(strays[0].relativeError! < 0.1)
  for (const d of SITE) for (const v of [d.ms, d.delayMs]) if (v !== undefined) {
    const rel = Math.abs(nearestMultiple(20, v) - v) / v
    assert.ok(rel < 0.1, `${d.name} ${v} ms is ${rel} from a multiple of 20`)
  }
})

test("A1-32.1 a base of 40 ms would not keep the site's feel within 10 percent (the 60 ms delay)", () => {
  const worst = Math.max(...SITE.flatMap((d) => [d.ms, d.delayMs]).filter((v): v is number => v !== undefined).map((v) => Math.abs(nearestMultiple(40, v) - v) / v))
  assert.ok(worst > 0.1)
})

test("A1-32.1 with the site's easings declared, the checker reports nothing but 110 ms", () => {
  const c = cadence(20, { ...siteEasings, ease: CSS_EASINGS.ease, in: CSS_EASINGS["ease-in"], out: CSS_EASINGS["ease-out"], roll: [0.32, 0.72, 0, 1] })
  const strays = checkMotion(c, SITE)
  assert.deepEqual(strays.map((s) => [s.field, s.value]), [["ms", 110]])
})

test("A1-32.1 the checker reports unparsable easings and negative or non-finite values", () => {
  const c = cadence(20, siteEasings)
  const strays = checkMotion(c, [
    { name: "a", easing: "var(--ease)" },
    { name: "b", ms: -20 },
    { name: "c", ms: NaN },
    { name: "d", ms: 0, delayMs: 0 },
  ])
  assert.deepEqual(strays.map((s) => [s.name, s.reason]), [["a", "unparsable-easing"], ["b", "not-a-multiple"], ["c", "not-a-multiple"]])
})

test("A1-32.1 the checker agrees with the module on random values", () => {
  for (const base of [10, 16, 25, 40]) {
    const c = cadence(base, siteEasings)
    for (let n = 0; n < 60; n++) {
      assert.deepEqual(checkMotion(c, [{ name: "x", ms: c.duration(n) }]), [], `${base} x ${n}`)
      assert.equal(checkMotion(c, [{ name: "x", ms: c.duration(n) + base / 2 }]).length, 1)
    }
  }
})

const panel: Surface = { id: "panel", rest: { offset: 0, glow: 0, opacity: 1, shown: false } }
const types: MotionType[] = [
  { name: "slide", ends: { offset: 0, glow: 0, opacity: 1, shown: false } },
  { name: "glow", ends: { offset: 0, glow: 0, opacity: 1, shown: false } },
]

test("A1-32.2 a motion type that ends anywhere but rest is reported with the fields that differ", () => {
  assert.deepEqual(motionTypesThatDoNotRest(panel, types), [])
  const bad: MotionType[] = [...types, { name: "stuck-glow", ends: { offset: 0, glow: 0.4, opacity: 1, shown: false } }, { name: "partial", ends: { offset: 0 } }]
  assert.deepEqual(motionTypesThatDoNotRest(panel, bad), [
    { motion: "stuck-glow", reason: "does-not-end-at-rest", fields: ["glow"] },
    { motion: "partial", reason: "does-not-end-at-rest", fields: ["glow", "opacity", "shown"] },
  ])
})

test("A1-32.2 a surface is at rest only when nothing runs and nothing is off its rest values", () => {
  assert.equal(restStatus(panel, panel.rest, [], types).atRest, true)
  assert.equal(restStatus(panel, panel.rest, [{ id: "m1", type: "slide" }], types).atRest, false)
  const glowing = restStatus(panel, { ...panel.rest, glow: 0.3 }, [], types)
  assert.equal(glowing.atRest, false)
  assert.deepEqual(glowing.returns, { finish: [], set: { glow: 0 } })
})

test("A1-32.2 what returns the surface to rest is named: the motions to finish and the values to set", () => {
  const r = restStatus(panel, { offset: 40, glow: 0.2, opacity: 1, shown: true }, [{ id: "m1", type: "slide" }, { id: "m2", type: "glow" }], types)
  assert.deepEqual(r.returns, { finish: ["m1", "m2"], set: { offset: 0, glow: 0, shown: false } })
  assert.deepEqual(r.problems, [])
})

test("A1-32.2 a running motion of an unknown type, or one that does not end at rest, is a problem and not a return", () => {
  const r = restStatus(panel, panel.rest, [{ id: "m1", type: "wobble" }, { id: "m2", type: "stuck" }], [...types, { name: "stuck", ends: { ...panel.rest, glow: 1 } }])
  assert.deepEqual(r.problems, [
    { motion: "m1", reason: "unknown-type", fields: [] },
    { motion: "m2", reason: "does-not-end-at-rest", fields: ["glow"] },
  ])
})

test("A1-32.2 finishing every running motion and setting the named values always reaches rest (random surfaces)", () => {
  let seed = 11
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let n = 0; n < 300; n++) {
    const rest: State = { a: Math.floor(rnd() * 3), b: rnd() < 0.5, c: rnd() < 0.5 ? "x" : "y", d: 0 }
    const surface: Surface = { id: "s", rest }
    const ts: MotionType[] = [{ name: "t1", ends: { ...rest } }, { name: "t2", ends: { ...rest } }]
    const current: Record<string, Value> = { a: Math.floor(rnd() * 3), b: rnd() < 0.5, c: rnd() < 0.5 ? "x" : "y", d: rnd() < 0.5 ? 0 : 1 }
    const running = shuffled(["t1", "t2"], n).slice(0, Math.floor(rnd() * 3)).map((t, i) => ({ id: `m${i}`, type: t }))
    const r = restStatus(surface, current, running, ts)
    assert.deepEqual(r.problems, [])
    const after = { ...current, ...r.returns.set }
    assert.deepEqual(after, rest, "values set as named reach rest")
    assert.equal(restStatus(surface, after, [], ts).atRest, true)
    assert.equal(r.atRest, running.length === 0 && Object.keys(r.returns.set).length === 0)
  }
})

const plan = (final: State, announcement = "3 moved, 1 added"): PlannedMotion => ({ type: "slide", final, announcement, durationMs: 620, easing: SITE_EASE })

test("A1-32.3 reduced motion is rest plus the instant change: no duration, rest values, same final state and announcement", () => {
  const p = plan({ order: "c,a,b", selected: "c" })
  const r = reduceMotion(panel, p)
  assert.equal(r.durationMs, 0)
  assert.deepEqual(r.motion, panel.rest)
  assert.deepEqual(r.final, p.final)
  assert.equal(r.announcement, p.announcement)
  assert.deepEqual(informationLost(p, r), { fields: [], announcement: false })
})

test("A1-32.3 reduced motion loses no field of the final state, including falsy values (random plans)", () => {
  let seed = 3
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const pool: Value[] = [0, "", false, 1, "x", true, -1, 0.5]
  for (let n = 0; n < 300; n++) {
    const final: Record<string, Value> = {}
    for (let k = 0, m = 1 + Math.floor(rnd() * 8); k < m; k++) final[`f${k}`] = pool[Math.floor(rnd() * pool.length)]
    const p = plan(final, `change ${n}`)
    const r = reduceMotion(panel, p)
    assert.deepEqual(Object.keys(r.final).sort(), Object.keys(final).sort())
    for (const k of Object.keys(final)) assert.equal(r.final[k], final[k], k)
    assert.deepEqual(informationLost(p, r), { fields: [], announcement: false })
    assert.deepEqual(r.motion, panel.rest)
  }
})

test("A1-32.3 the loss check does see a dropped field, a changed value and a changed announcement", () => {
  const p = plan({ a: 1, b: 0 })
  const r = reduceMotion(panel, p)
  assert.deepEqual(informationLost(p, { ...r, final: { a: 1 } }).fields, ["b"])
  assert.deepEqual(informationLost(p, { ...r, final: { a: 1, b: 1 } }).fields, ["b"])
  assert.equal(informationLost(p, { ...r, announcement: "" }).announcement, true)
})

test("A1-32.3 the reduced form is a copy: changing it does not change the plan or the surface's rest", () => {
  const p = plan({ a: 1 })
  const r = reduceMotion(panel, p) as any
  r.final.a = 99
  r.motion.glow = 7
  assert.equal(p.final.a, 1)
  assert.equal(panel.rest.glow, 0)
})

test("A1-32.1 a film's own frames are a declared stepped timing, and an undeclared one is reported", () => {
  const c = cadence(10, { ease: CSS_EASINGS.ease }, { film: { steps: 192, position: "jump-end" } })
  assert.equal(c.stepped("film"), "steps(192, jump-end)")
  assert.deepEqual(parseSteps("steps(192, end)"), { steps: 192, position: "jump-end" })
  assert.deepEqual(parseSteps("steps(4)"), { steps: 4, position: "jump-end" })
  assert.deepEqual(parseSteps("step-start"), { steps: 1, position: "jump-start" })
  assert.equal(parseSteps("steps(0, end)"), null)
  assert.equal(parseSteps("steps(1, jump-none)"), null)
  assert.equal(parseSteps("steps(3, sideways)"), null)
  assert.deepEqual(checkMotion(c, [{ name: "turn", ms: 8000, easing: "steps(192, end)" }]), [])
  assert.deepEqual(checkMotion(c, [{ name: "other", easing: "steps(24, end)" }]).map((s) => s.reason), ["undeclared-easing"])
  assert.throws(() => c.stepped("none"), /no stepped timing/)
  assert.throws(() => cadence(10, {}, { bad: { steps: 0, position: "jump-end" } }), /not a CSS steps/)
})

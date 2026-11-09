import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { pathToFileURL } from "node:url"
import {
  CAPABILITY_FOR, GRAMMAR, MODES, POINTER_FEEL, POINTER_TIMING, PEN_FEEL, TOUCH_CONSTANTS,
  clampCertainty, defaultAdapters, gazeAdapter, hoverFactor, initialMode, intent, keyboardAdapter, modeOfPointerType, newSession,
  observeMode, penAdapter, pointerAdapter, present, reading, stepSession, switchAdapter, touchAdapter, voiceAdapter, voiceReading,
  type Input, type Intent, type Operation, type Session, type Target,
} from "../src/intent.ts"
import * as core from "../src/reading.ts"
import { CAPABILITIES } from "../src/capabilities.ts"
import { Ajv2020, read, root } from "./helpers.ts"

const near = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`)

const A: Target = { id: "a", box: { left: 100, top: 100, right: 200, bottom: 140 } }
const B: Target = { id: "b", box: { left: 400, top: 100, right: 500, bottom: 140 } }
const labels = [{ id: "a", label: "Projects" }, { id: "b", label: "Process notes" }]

const script: [Input, number][] = [
  [{ mode: "pointer", type: "move", x: 20, y: 120 }, 1000],
  [{ mode: "pointer", type: "move", x: 60, y: 120 }, 1016],
  [{ mode: "pointer", type: "frame", targets: [A, B] }, 1016],
  [{ mode: "pointer", type: "press", target: "a" }, 1100],
  [{ mode: "pointer", type: "secondary", target: "a" }, 1200],
  [{ mode: "pen", type: "move", x: 90, y: 120, height: 0.4 }, 2000],
  [{ mode: "pen", type: "frame", targets: [A, B] }, 2016],
  [{ mode: "pen", type: "press", target: "a" }, 2100],
  [{ mode: "pen", type: "secondary", target: "a" }, 2200],
  [{ mode: "touch", type: "down", target: "a" }, 3000],
  [{ mode: "touch", type: "up", target: "a" }, 3050],
  [{ mode: "touch", type: "down", target: "a" }, 3200],
  [{ mode: "touch", type: "up", target: "a" }, 3250],
  [{ mode: "touch", type: "down", target: "b" }, 3400],
  [{ mode: "touch", type: "tick" }, 4000],
  [{ mode: "keyboard", type: "keydown", key: "Tab" }, 5000],
  [{ mode: "keyboard", type: "focus", target: "a", order: ["a", "b"] }, 5001],
  [{ mode: "keyboard", type: "keydown", key: "Enter" }, 5100],
  [{ mode: "keyboard", type: "keydown", key: "ContextMenu" }, 5200],
  [{ mode: "voice", type: "partial", transcript: "pro", labels }, 6000],
  [{ mode: "voice", type: "final", transcript: "projects", labels }, 6100],
  [{ mode: "voice", type: "final", transcript: "show projects", labels }, 6200],
  [{ mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A, B] }, 7000],
  [{ mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A, B] }, 7800],
  [{ mode: "gaze", type: "confirm" }, 7900],
  [{ mode: "switch", type: "start", order: ["a", "b"] }, 8000],
  [{ mode: "switch", type: "tick" }, 8500],
  [{ mode: "switch", type: "select" }, 8600],
  [{ mode: "switch", type: "peek" }, 8700],
]

function run(inputs: [Input, number][]) {
  const adapters = defaultAdapters()
  let session: Session = newSession()
  const intents: Intent[] = []
  const operations: (Operation & { from: string })[] = []
  for (const [input, now] of inputs) {
    const r = stepSession(adapters, session, input, now)
    session = r.session
    intents.push(...r.intents)
    operations.push(...r.operations.map((o) => ({ ...o, from: input.mode })))
  }
  return { intents, operations, session }
}

function specGrammar(): string[] {
  const text = readFileSync(join(root, "spec/SPEC.md"), "utf8")
  const table = text.slice(text.indexOf("## 06. The interaction grammar"), text.indexOf("### 6.1"))
  return [...table.matchAll(/^\| ([A-Z][a-z]+) \|/gm)].map((m) => m[1]).filter((v) => v !== "Operation")
}

test("A1-31.1 the grammar the adapters draw on is exactly the section 6 table", () => {
  assert.deepEqual([...GRAMMAR], specGrammar())
})

test("A1-31.1 a scripted session through every adapter emits only section 6 operations and well-formed intents", () => {
  const { intents, operations } = run(script)
  assert.ok(operations.length >= 14, `the script produced ${operations.length} operations`)
  for (const o of operations) {
    assert.ok((GRAMMAR as readonly string[]).includes(o.operation), `${o.operation} is not a section 6 operation`)
    assert.deepEqual(Object.keys(o).sort(), ["from", "operation", "target", "via"])
  }
  for (const i of intents) {
    assert.deepEqual(Object.keys(i).sort(), ["certainty", "target"])
    assert.ok(i.certainty >= 0 && i.certainty <= 1 && !Number.isNaN(i.certainty))
  }
  const modes = new Set(operations.map((o) => o.from))
  for (const m of MODES) assert.ok(modes.has(m), `${m} emitted an operation in the script`)
})

test("A1-31.1 every capability a verb is carried out by exists in the catalogue", () => {
  for (const [verb, id] of Object.entries(CAPABILITY_FOR)) {
    assert.ok((GRAMMAR as readonly string[]).includes(verb))
    assert.ok(CAPABILITIES.some((c) => c.id === id), `${verb} -> ${id}`)
  }
})

test("A1-31.1 no operation requires one device: every mode can Enter and Inspect a target", () => {
  const { operations } = run(script)
  for (const verb of ["Enter", "Inspect"]) {
    const by = new Set(operations.filter((o) => o.operation === verb).map((o) => o.from))
    assert.deepEqual([...by].sort(), [...MODES].sort(), `${verb} is reachable from every mode`)
  }
  for (const o of operations) assert.equal("mode" in o && o.operation === undefined, false)
})

test("A1-31.2 an Intent is clamped to 0..1 and NaN is refused", () => {
  assert.equal(clampCertainty(-3), 0)
  assert.equal(clampCertainty(7), 1)
  assert.equal(clampCertainty(0.25), 0.25)
  assert.equal(intent("x", 2).certainty, 1)
  assert.throws(() => clampCertainty(NaN), RangeError)
  assert.throws(() => intent("x", NaN), RangeError)
})

test("A1-31.2 an Intent carries a number and a target, and no probability or percentage", () => {
  const i = intent("a", 0.5)
  assert.deepEqual(Object.keys(i).sort(), ["certainty", "target"])
  assert.equal(typeof i.certainty, "number")
  const src = readFileSync(join(root, "packages/core/src/intent.ts"), "utf8")
  assert.equal(/probab|percent/i.test(src.replace(/not a probability|probability/g, "")), false)
})

function drive(adapter: ReturnType<typeof pointerAdapter> | ReturnType<typeof penAdapter>, path: [number, number, number?][], targets: Target[], extraFrames = 0) {
  let state: any = adapter.init()
  let now = 1000
  let last: Intent[] = []
  for (const [x, y, h] of path) {
    now += 16
    state = adapter.step(state, { mode: adapter.mode, type: "move", x, y, ...(h !== undefined ? { height: h } : {}) } as any, now).state
    const r = adapter.step(state, { mode: adapter.mode, type: "frame", targets } as any, now)
    state = r.state
    last = r.intents
  }
  for (let i = 0; i < extraFrames; i++) {
    now += 16
    const r = adapter.step(state, { mode: adapter.mode, type: "frame", targets } as any, now)
    state = r.state
    last = r.intents
  }
  return { last, state }
}
const cert = (xs: Intent[], id: string) => xs.find((i) => i.target === id)!.certainty

test("A1-31.2 pointer: a path heading for a target reads higher than the same position heading away", () => {
  const toward = drive(pointerAdapter(), [[0, 120], [20, 120], [40, 120], [60, 120]], [A])
  const away = drive(pointerAdapter(), [[120, 300], [100, 300], [80, 300], [60, 120 + 180]], [A])
  assert.ok(cert(toward.last, "a") > 0.3)
  assert.ok(cert(toward.last, "a") > cert(away.last, "a"))
  assert.equal(cert(drive(pointerAdapter(), [[900, 900]], [A], 40).last, "a"), 0)
})

test("A1-31.2 pointer: the leading target takes the pointer and the other does not switch off at once", () => {
  const { last } = drive(pointerAdapter(), [[150, 120], [150, 121]], [A, B], 20)
  assert.ok(cert(last, "a") > 0.9)
  assert.ok(cert(last, "b") < 0.01)
})

test("A1-31.2 pen: certainty falls as the pen lifts, and is the pointer reading at contact", () => {
  const at = (h: number) => cert(drive(penAdapter(), [[150, 120, h], [150, 121, h]], [A], 30).last, "a")
  const contact = at(0), mid = at(0.5), high = at(0.95)
  assert.ok(contact > mid && mid > high, `${contact} ${mid} ${high}`)
  near(hoverFactor(0), 1)
  near(hoverFactor(1), 0)
  near(contact, cert(drive(pointerAdapter(), [[150, 120], [150, 121]], [A], 30).last, "a"), 1e-9)
})

test("A1-31.2 touch: there is no certainty before a touch-down, and touch-down is the evidence", () => {
  const t = touchAdapter()
  const idle = t.step(t.init(), { mode: "touch", type: "tick" }, 100)
  assert.deepEqual(idle.intents, [])
  const down = t.step(idle.state, { mode: "touch", type: "down", target: "a" }, 200)
  assert.deepEqual(down.intents, [{ target: "a", certainty: 1 }])
  const cancel = t.step(down.state, { mode: "touch", type: "cancel" }, 250)
  assert.deepEqual(cancel.intents, [{ target: "a", certainty: 0 }])
})

test("A1-31.2 keyboard: one step lands with certainty 1, and a held key moves certainty to the target ahead", () => {
  const k = keyboardAdapter()
  const order = ["a", "b", "c", "d"]
  let s = k.init()
  const press = (key: string, now: number, repeat = false) => (s = k.step(s, { mode: "keyboard", type: "keydown", key, repeat }, now).state)
  press("ArrowDown", 0)
  let r = k.step(s, { mode: "keyboard", type: "focus", target: "a", order }, 1)
  assert.deepEqual(r.intents, [{ target: "a", certainty: 1 }])
  s = r.state
  const seen: number[] = []
  for (let n = 1; n <= 5; n++) {
    press("ArrowDown", 100 + n * 30, true)
    r = k.step(s, { mode: "keyboard", type: "focus", target: order[Math.min(n, 2)], order }, 101 + n * 30)
    s = r.state
    seen.push(r.intents.find((i) => i.target === "c")?.certainty ?? 0)
  }
  assert.ok(seen.some((v) => v > 0))
  const held = r.intents.find((i) => i.certainty > 0 && i.target !== "c")
  assert.ok(held && held.certainty < 1, "the target passed through holds less than full certainty while the key repeats")
  const fresh = k.step(k.init(), { mode: "keyboard", type: "focus", target: "b", order }, 5000)
  assert.deepEqual(fresh.intents, [{ target: "b", certainty: 1 }])
})

test("A1-31.2 voice: certainty is the share of a label spoken so far, split among labels sharing the prefix", () => {
  const one = voiceReading("proj", labels)
  assert.deepEqual(one, [{ target: "a", certainty: 4 / 8 }])
  const both = voiceReading("pro", labels)
  near(both.find((i) => i.target === "a")!.certainty, 3 / 8 / 2)
  near(both.find((i) => i.target === "b")!.certainty, 3 / 13 / 2)
  assert.equal(voiceReading("zzz", labels).length, 0)
  assert.deepEqual(voiceReading("Projects.", labels), [{ target: "a", certainty: 1 }])
  assert.deepEqual(voiceReading("", labels), [])
  assert.ok(voiceReading("proje", labels)[0].certainty > voiceReading("proj", labels)[0].certainty)
})

test("A1-31.2 gaze: certainty rises with dwell and a stray glance does not reset it", () => {
  const g = gazeAdapter()
  let r = g.step(g.init(), { mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A, B] }, 1000)
  assert.equal(cert(r.intents, "a"), 0)
  r = g.step(r.state, { mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A, B] }, 1400)
  near(cert(r.intents, "a"), 0.5)
  r = g.step(r.state, { mode: "gaze", type: "gaze", x: 300, y: 300, targets: [A, B] }, 1500)
  near(cert(r.intents, "a"), 500 / 800)
  r = g.step(r.state, { mode: "gaze", type: "gaze", x: 300, y: 300, targets: [A, B] }, 1700)
  assert.equal(cert(r.intents, "a"), 0)
})

test("A1-31.2 switch: the cursor target reads 1 and the next one rises as the step nears", () => {
  const s = switchAdapter()
  let r = s.step(s.init(), { mode: "switch", type: "start", order: ["a", "b", "c"] }, 0)
  assert.equal(cert(r.intents, "a"), 1)
  r = s.step(r.state, { mode: "switch", type: "tick" }, 500)
  near(cert(r.intents, "b"), 0.5)
  r = s.step(r.state, { mode: "switch", type: "tick" }, 1000)
  assert.equal(cert(r.intents, "b"), 1)
  assert.equal(cert(r.intents, "a"), 0)
  r = s.step(r.state, { mode: "switch", type: "tick" }, 3000)
  assert.equal(cert(r.intents, "a"), 1, "the cursor wraps around")
})

test("A1-31.3 the same certainty gives the same number to every presentation", () => {
  for (const c of [0, 0.001, 0.333, 0.5, 1]) {
    const i = intent("a", c)
    const underline = present(i, (n) => `${n}`)
    const reflection = present(i, (n) => n)
    const preview = present(i, (n) => ({ opens: n > 0.5, n }))
    assert.equal(Number(underline), c)
    assert.equal(reflection, c)
    assert.equal(preview.n, c)
    assert.equal(reading(i), c)
  }
})

test("A1-31.3 the reading does not depend on the target or the mode that produced it", () => {
  const seen = new Set(MODES.map((m) => reading(intent(`t-${m}`, 0.37))))
  assert.equal(seen.size, 1)
})

const touch = () => {
  const t = touchAdapter()
  let s = t.init()
  const send = (input: any, now: number) => {
    const r = t.step(s, { mode: "touch", ...input }, now)
    s = r.state
    return r
  }
  return { send, get state() { return s } }
}

test("A1-31.4 touch: the first tap reveals and does not commit", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  const up = t.send({ type: "up", target: "a" }, 80)
  assert.deepEqual(up.operations, [{ operation: "Inspect", target: "a", via: "first-tap" }])
})

test("A1-31.4 touch: a second tap on the same target commits", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  t.send({ type: "up", target: "a" }, 80)
  t.send({ type: "down", target: "a" }, 600)
  const up = t.send({ type: "up", target: "a" }, 680)
  assert.deepEqual(up.operations, [{ operation: "Enter", target: "a", via: "second-tap" }])
  assert.deepEqual(up.intents, [{ target: "a", certainty: 0 }], "once committed, the intent is spent")
})

test("A1-31.4 touch: a tap on another target reveals that one and never commits the first", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  t.send({ type: "up", target: "a" }, 80)
  t.send({ type: "down", target: "b" }, 300)
  const up = t.send({ type: "up", target: "b" }, 380)
  assert.deepEqual(up.operations, [{ operation: "Inspect", target: "b", via: "first-tap" }])
  assert.deepEqual(up.intents.find((i) => i.target === "a"), { target: "a", certainty: 0 }, "the reveal moves to b; a returns to rest")
  assert.deepEqual(up.intents.find((i) => i.target === "b"), { target: "b", certainty: 1 })
  t.send({ type: "down", target: "a" }, 500)
  assert.equal(t.send({ type: "up", target: "a" }, 560).operations[0].via, "first-tap", "a's reveal is gone, so a tap on a reveals again")
})

test("A1-31.4 touch: a reveal that is not answered returns to rest", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  t.send({ type: "up", target: "a" }, 80)
  const late = t.send({ type: "tick" }, 80 + TOUCH_CONSTANTS.revealHold)
  assert.deepEqual(late.intents, [{ target: "a", certainty: 0 }])
  t.send({ type: "down", target: "a" }, 9000)
  const up = t.send({ type: "up", target: "a" }, 9050)
  assert.equal(up.operations[0].operation, "Inspect", "after the reveal expired, a tap reveals again, it does not commit")
})

test("A1-31.4 touch: a long press peeks, once, and releasing it commits nothing", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  const held = t.send({ type: "tick" }, TOUCH_CONSTANTS.longPress)
  assert.deepEqual(held.operations, [{ operation: "Inspect", target: "a", via: "long-press" }])
  assert.deepEqual(t.send({ type: "tick" }, TOUCH_CONSTANTS.longPress + 100).operations, [])
  const up = t.send({ type: "up", target: "a" }, TOUCH_CONSTANTS.longPress + 200)
  assert.deepEqual(up.operations, [])
  const u = touch()
  u.send({ type: "down", target: "a" }, 0)
  assert.deepEqual(u.send({ type: "up", target: "a" }, 700).operations, [{ operation: "Inspect", target: "a", via: "long-press" }])
})

test("A1-31.4 touch: a finger that slides off its target neither reveals nor commits", () => {
  const t = touch()
  t.send({ type: "down", target: "a" }, 0)
  assert.deepEqual(t.send({ type: "up", target: "b" }, 50).operations, [])
  assert.deepEqual(t.send({ type: "up", target: null }, 60).operations, [])
})

test("A1-31.4 every mode that lacks hover has a preview step: gaze dwell, switch peek, spoken show, context-menu key", () => {
  const { operations } = run(script)
  const via = new Set(operations.filter((o) => o.operation === "Inspect").map((o) => o.via))
  for (const v of ["first-tap", "long-press", "dwell", "switch-peek", "spoken-inspect", "context-menu-key"]) assert.ok(via.has(v), v)
  const g = gazeAdapter()
  let r = g.step(g.init(), { mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A] }, 0)
  r = g.step(r.state, { mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A] }, 5000)
  assert.deepEqual(r.operations.map((o) => o.operation), ["Inspect"])
  assert.deepEqual(g.step(r.state, { mode: "gaze", type: "gaze", x: 150, y: 120, targets: [A] }, 9000).operations, [])
})

test("A1-31.4 voice: only an exact label commits, a partial or unknown phrase does not", () => {
  const v = voiceAdapter()
  assert.deepEqual(v.step(v.init(), { mode: "voice", type: "partial", transcript: "projects", labels }, 0).operations, [])
  assert.deepEqual(v.step(v.init(), { mode: "voice", type: "final", transcript: "proj", labels }, 0).operations, [])
  assert.deepEqual(v.step(v.init(), { mode: "voice", type: "final", transcript: "Projects!", labels }, 0).operations, [{ operation: "Enter", target: "a", via: "spoken-label" }])
})

test("A1-31.5 the mode follows the latest event, in either direction, any number of times", () => {
  let m = initialMode
  const seq: [string, string][] = [["mouse", "pointer"], ["touch", "touch"], ["pen", "pen"], ["mouse", "pointer"], ["touch", "touch"]]
  seq.forEach(([pt, expected], i) => {
    const r = observeMode(m, modeOfPointerType(pt), 100 * i)
    assert.equal(r.state.mode, expected)
    assert.equal(r.changed, i === 0 || seq[i - 1][1] !== expected)
    m = r.state
  })
  assert.equal(m.changes, 4)
  const same = observeMode(m, "touch", 999)
  assert.equal(same.changed, false)
  assert.equal(same.state.since, m.since, "no change leaves the time it began alone")
  const kb = observeMode(m, "keyboard", 1000)
  assert.deepEqual([kb.from, kb.state.mode, kb.changed], ["touch", "keyboard", true])
})

test("A1-31.5 a mouse and a pen and a finger on the same device are three modes, by pointerType", () => {
  assert.equal(modeOfPointerType("mouse"), "pointer")
  assert.equal(modeOfPointerType("pen"), "pen")
  assert.equal(modeOfPointerType("touch"), "touch")
  assert.equal(modeOfPointerType(""), "pointer")
})

test("A1-31.5 a session routes each event to its own mode's adapter and reports the change", () => {
  const adapters = defaultAdapters()
  let s = newSession()
  const modes: string[] = []
  const changes: boolean[] = []
  for (const [input, now] of script) {
    const r = stepSession(adapters, s, input, now)
    s = r.session
    modes.push(r.mode)
    changes.push(r.changed)
    assert.equal(r.mode, input.mode)
    assert.equal(s.mode.mode, input.mode)
  }
  assert.equal(changes.filter(Boolean).length, 7, "seven mode runs in the script")
  assert.equal(changes[0], true)
})

test("A1-31.5 when the mode changes, what the earlier mode was lighting falls to 0", () => {
  const adapters = defaultAdapters()
  let s = newSession()
  let r = stepSession(adapters, s, { mode: "touch", type: "down", target: "a" }, 0)
  s = r.session
  assert.deepEqual(r.intents, [{ target: "a", certainty: 1 }])
  r = stepSession(adapters, s, { mode: "keyboard", type: "focus", target: "b", order: ["a", "b"] }, 10)
  assert.ok(r.changed)
  assert.deepEqual(r.intents.filter((i) => i.target === "a"), [{ target: "a", certainty: 0 }])
  assert.deepEqual(r.intents.filter((i) => i.target === "b"), [{ target: "b", certainty: 1 }])
  s = r.session
  r = stepSession(adapters, s, { mode: "touch", type: "down", target: "a" }, 20)
  r = stepSession(adapters, r.session, { mode: "touch", type: "up", target: "a" }, 60)
  assert.equal(r.operations[0].operation, "Inspect")
})

test("A1-31.6 every adapter declares its own time constants", () => {
  const adapters = defaultAdapters()
  for (const m of MODES) {
    const c = adapters[m].constants
    assert.ok(Object.keys(c).length > 0, `${m} declares constants`)
    for (const v of Object.values(c)) assert.ok(typeof v === "number" && Number.isFinite(v) && v > 0, `${m}: ${v}`)
  }
  assert.equal(adapters.touch.constants.longPress, 500)
  assert.equal(adapters.gaze.constants.dwellFull, 800)
  assert.equal(adapters.pointer.constants.riseTau, 85)
})

test("A1-31.6 the reading module exports functions only: no constant lives in the reading", async () => {
  const mod = await import("../src/reading.ts")
  for (const [name, v] of Object.entries(mod)) assert.equal(typeof v, "function", `${name} is a ${typeof v}`)
  const src = readFileSync(join(root, "packages/core/src/reading.ts"), "utf8")
  assert.equal(/^export const [A-Z_]+ =/m.test(src), false)
})

test("A1-31.6 changing an adapter's constants changes that adapter and no other", () => {
  const path: [number, number][] = [[0, 120], [20, 120], [40, 120], [60, 120]]
  const base = cert(drive(pointerAdapter(), path, [A]).last, "a")
  const slow = cert(drive(pointerAdapter({ feel: { riseTau: 400 } }), path, [A]).last, "a")
  assert.ok(slow < base, "a slower rise reads lower after the same path")
  const pen = penAdapter()
  assert.equal(pen.constants.riseTau, 85)
  assert.equal(pointerAdapter({ feel: { riseTau: 400 } }).constants.riseTau, 400)
  assert.equal(penAdapter().constants.riseTau, 85, "the pen's constants are its own")
  assert.notEqual(PEN_FEEL, POINTER_FEEL)
  const t = touchAdapter({ constants: { longPress: 2000 } })
  let r = t.step(t.init(), { mode: "touch", type: "down", target: "a" }, 0)
  assert.deepEqual(t.step(r.state, { mode: "touch", type: "tick" }, 600).operations, [])
})

const SITE_ROOT = (process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir())
const SITE = ["tests/reference/approach/reading.ts", "lib/approach/reading.ts"].map((f) => join(SITE_ROOT, f)).find((f) => existsSync(f)) ?? join(SITE_ROOT, "lib/approach/reading.ts")
const site = existsSync(SITE) ? await import(pathToFileURL(SITE).href) : null
const box = { left: 100, top: 100, right: 200, bottom: 140 }
const F = POINTER_FEEL

test("A1-31.6 the pointer constants are the site's tuned values", () => {
  assert.deepEqual({ ...POINTER_FEEL }, { lookahead: 160, maxLead: 140, fullSpeed: 0.6, velocityTau: 70, restTau: 90, riseTau: 85, fallTau: 160, share: 10 })
  assert.deepEqual({ ...POINTER_TIMING }, { stillAfter: 30, longestFrame: 50, longestGap: 100, firstFrame: 1000 / 60, stillSpeed: 0.002 })
})

test("A1-31.6 the core's reading gives the site's numbers: score (pinned)", () => {
  assert.equal(core.score(box, { x: 20, y: 120, vx: 0, vy: 0 }, 72, F), 0)
  assert.equal(core.score(box, { x: 20, y: 120, vx: 0.5, vy: 0 }, 72, F), 0.8333333333333334)
  assert.equal(core.score(box, { x: 60, y: 120, vx: 0.9, vy: 0.1 }, 72, F), 0.9938837346736189)
})

test("A1-31.6 the core's reading gives the site's numbers: share, ease, follow, rest, project (pinned)", () => {
  assert.deepEqual(core.share([0.9, 0.5, 0.1], F), [0.8974863613184048, 0.0013964657912214674, 2.859961940421567e-11])
  assert.deepEqual(core.share([0.4, 0.4], F), [0.2, 0.2])
  assert.deepEqual(core.share([0, 0], F), [0, 0])
  assert.equal(core.ease(0, 1, 16, F), 0.17158023799809463)
  assert.equal(core.ease(1, 0, 16, F), 0.9048374180359595)
  assert.equal(core.ease(0.9995, 1, 16, F), 1)
  assert.deepEqual(core.follow({ x: 0, y: 0, vx: 0, vy: 0 }, 10, 4, 16, F), { x: 10, y: 4, vx: 0.12770658647394198, vy: 0.05108263458957679 })
  assert.deepEqual(core.rest({ x: 0, y: 0, vx: 0.5, vy: -0.2 }, 30, F), { x: 0, y: 0, vx: 0.35826565528689464, vy: -0.14330626211475786 })
  assert.deepEqual(core.project({ x: 0, y: 0, vx: 2, vy: 0 }, F), { x: 140, y: 0 })
})

test("A1-31.6 the core's reading equals the site's file on many inputs (when the site is on this machine)", { skip: site ? false : "the site's reading.ts is not on this machine" }, () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let n = 0; n < 2000; n++) {
    const p = { x: rnd() * 600, y: rnd() * 300, vx: (rnd() - 0.5) * 2.4, vy: (rnd() - 0.5) * 2.4 }
    const left = rnd() * 400, top = rnd() * 200
    const b = { left, top, right: left + 20 + rnd() * 200, bottom: top + 10 + rnd() * 80 }
    const r = 20 + rnd() * 100, dt = 1 + rnd() * 60
    const x = rnd() * 600, y = rnd() * 300
    assert.equal(core.score(b, p, r, F), site.score(b, p, r))
    assert.deepEqual(core.project(p, F), site.project(p))
    assert.deepEqual(core.follow(p, x, y, dt, F), site.follow(p, x, y, dt))
    assert.deepEqual(core.rest(p, dt, F), site.rest(p, dt))
    const a = rnd(), g = rnd()
    assert.equal(core.ease(a, g, dt, F), site.ease(a, g, dt))
    const scores = [rnd(), rnd(), rnd() * 0.1]
    assert.deepEqual(core.share(scores, F), site.share(scores))
    assert.equal(core.smoothstep(a * 2 - 0.5), site.smoothstep(a * 2 - 0.5))
  }
})

function siteLoop(r: any, events: ({ at: number; x: number; y: number } | { at: number; frame: true })[], targets: Target[], radius = 72) {
  let pointer: any = { x: -1e4, y: -1e4, vx: 0, vy: 0 }
  let lastEvent = 0, lastFrame = 0
  const shown = new Map<string, number>()
  const frames: Record<string, number>[] = []
  for (const e of events) {
    if (!("frame" in e)) {
      const dt = e.at - lastEvent
      pointer = lastEvent && dt > 0 && dt < 100 ? r.follow(pointer, e.x, e.y, dt) : { x: e.x, y: e.y, vx: 0, vy: 0 }
      lastEvent = e.at
      continue
    }
    const dt = lastFrame ? Math.min(50, e.at - lastFrame) : 1000 / 60
    lastFrame = e.at
    if (e.at - lastEvent > 30) pointer = r.rest(pointer, dt)
    const goals = r.share(targets.map((t) => r.score(t.box, pointer, radius)))
    let settling = Math.hypot(pointer.vx, pointer.vy) > 0.002
    const row: Record<string, number> = {}
    targets.forEach((t, i) => {
      const after = r.ease(shown.get(t.id) ?? 0, goals[i], dt)
      if (after !== goals[i]) settling = true
      shown.set(t.id, after)
      row[t.id] = after
    })
    frames.push(row)
    if (!settling) lastFrame = 0
  }
  return frames
}
function adapterLoop(events: ({ at: number; x: number; y: number } | { at: number; frame: true })[], targets: Target[]) {
  const a = pointerAdapter()
  let s = a.init()
  const frames: Record<string, number>[] = []
  for (const e of events) {
    if (!("frame" in e)) { s = a.step(s, { mode: "pointer", type: "move", x: e.x, y: e.y }, e.at).state; continue }
    const r = a.step(s, { mode: "pointer", type: "frame", targets }, e.at)
    s = r.state
    frames.push(Object.fromEntries(r.intents.map((i) => [i.target, i.certainty])))
  }
  return frames
}
const sweep = () => {
  const events: ({ at: number; x: number; y: number } | { at: number; frame: true })[] = []
  let t = 1000
  for (let i = 0; i < 30; i++) { t += 16; events.push({ at: t, x: 20 + i * 9, y: 118 + Math.sin(i / 4) * 12 }); events.push({ at: t, frame: true }) }
  for (let i = 0; i < 60; i++) { t += 16; events.push({ at: t, frame: true }) }
  for (let i = 0; i < 20; i++) { t += 16; events.push({ at: t, x: 300 + i * 8, y: 120 }); events.push({ at: t, frame: true }) }
  return events
}

test("A1-31.6 the pointer adapter reproduces the site's approach loop frame for frame (pinned)", () => {
  const frames = adapterLoop(sweep(), [A, B])
  assert.equal(frames.length, 110)
  assert.deepEqual([frames[10], frames[29], frames[60], frames[109]], PINNED_FRAMES)
})

test("A1-31.6 the pointer adapter reproduces the site's approach loop frame for frame (against the site's file)", { skip: site ? false : "the site's reading.ts is not on this machine" }, () => {
  assert.deepEqual(adapterLoop(sweep(), [A, B]), siteLoop(site, sweep(), [A, B]))
})

const PINNED_FRAMES: Record<string, number>[] = [
  { a: 0.6689856225750674, b: 0 },
  { a: 0.5624096896341769, b: 0.1877998265637819 },
  { a: 0.025336107936428005, b: 0.014572182841139154 },
  { a: 0, b: 0.9068951843057661 },
]

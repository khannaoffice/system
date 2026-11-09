import { test } from "node:test"
import assert from "node:assert/strict"
import { approach } from "../src/approach.ts"
import { pointerAdapter, type PointerState, type Target } from "../../core/src/intent.ts"

type Box = { left: number; top: number; right: number; bottom: number }
interface Pointerish { pointerType: string; clientX?: number; clientY?: number; timeStamp: number }

function standIn({ fine = true, boxes }: { fine?: boolean; boxes: Record<string, Box> }) {
  const listeners = { window: new Map<string, Set<(e: Pointerish) => void>>(), root: new Map<string, Set<(e: Pointerish) => void>>() }
  const on = (m: Map<string, Set<(e: Pointerish) => void>>) => ({
    addEventListener: (type: string, fn: (e: Pointerish) => void) => { if (!m.has(type)) m.set(type, new Set()); m.get(type)!.add(fn) },
    removeEventListener: (type: string, fn: (e: Pointerish) => void) => { m.get(type)?.delete(fn) },
  })
  const near = new Map<string, string>()
  const elements = Object.keys(boxes).map((id) => ({
    id,
    getBoundingClientRect: () => boxes[id],
    style: {
      setProperty: (name: string, value: string) => { if (name === "--near") near.set(id, value) },
      removeProperty: (name: string) => { if (name === "--near") near.delete(id) },
    },
  }))
  let queue: { id: number; cb: (t: number) => void }[] = []
  let nextId = 1
  const g = globalThis as Record<string, unknown>
  const saved = { window: g.window, document: g.document, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame }
  g.window = { ...on(listeners.window), matchMedia: () => ({ matches: fine }) }
  g.document = { documentElement: on(listeners.root), querySelectorAll: () => elements }
  g.requestAnimationFrame = (cb: (t: number) => void) => { const id = nextId++; queue.push({ id, cb }); return id }
  g.cancelAnimationFrame = (id: number) => { queue = queue.filter((f) => f.id !== id) }
  const fire = (m: Map<string, Set<(e: Pointerish) => void>>, type: string, e: Pointerish) => { for (const fn of m.get(type) ?? []) fn(e) }
  return {
    near,
    listening: () => [...listeners.window.values(), ...listeners.root.values()].reduce((n, s) => n + s.size, 0),
    move: (x: number, y: number, t: number, pointerType = "mouse") => fire(listeners.window, "pointermove", { pointerType, clientX: x, clientY: y, timeStamp: t }),
    leave: (t: number) => fire(listeners.root, "pointerleave", { pointerType: "mouse", timeStamp: t }),
    frame: (t: number) => { const due = queue; queue = []; for (const f of due) f.cb(t); return due.length },
    restore: () => Object.assign(g, saved),
  }
}

const BOXES: Record<string, Box> = { a: { left: 100, top: 100, right: 200, bottom: 140 }, b: { left: 400, top: 100, right: 500, bottom: 140 } }
const targets: Target[] = Object.entries(BOXES).map(([id, box]) => ({ id, box }))
const MOVES: [number, number, number][] = [[20, 120, 0], [40, 121, 16], [60, 121, 32], [80, 120, 48], [95, 120, 64]]
const FRAMES = [16, 32, 48, 64, 80, 96, 112, 128, 200, 400]

test("every --near it writes is the core's pointer reading, to three places", () => {
  const page = standIn({ boxes: BOXES })
  try {
    const stop = approach({ selector: "a" })
    const adapter = pointerAdapter({ radius: 72 })
    let state: PointerState = adapter.init()
    const expected = new Map<string, string>()
    let m = 0
    for (const t of FRAMES) {
      while (m < MOVES.length && MOVES[m][2] < t) {
        const [x, y, at] = MOVES[m++]
        page.move(x, y, at)
        state = adapter.step(state, { mode: "pointer", type: "move", x, y }, at).state
      }
      if (page.frame(t) === 0) continue
      const step = adapter.step(state, { mode: "pointer", type: "frame", targets }, t)
      state = step.state
      for (const i of step.intents) expected.set(i.target, i.certainty.toFixed(3))
      assert.deepEqual(Object.fromEntries(page.near), Object.fromEntries(expected), `at ${t} ms`)
    }
    assert.ok(Number(page.near.get("a")) > 0.5, "the link the pointer is heading for answers")
    assert.ok(Number(page.near.get("b")) < 0.05, "the one it is moving away from stays quiet")
    stop()
  } finally { page.restore() }
})

test("it sleeps when nothing moves", () => {
  const page = standIn({ boxes: BOXES })
  try {
    const stop = approach()
    page.move(150, 120, 0)
    let frames = 0
    for (let t = 16; t < 5000 && page.frame(t) > 0; t += 16) frames += 1
    assert.ok(frames > 0 && frames < 300, `settled after ${frames} frames`)
    assert.equal(page.frame(6000), 0, "no frame is asked for once it has settled")
    stop()
  } finally { page.restore() }
})

test("leaving the page lets every target fall back to 0", () => {
  const page = standIn({ boxes: BOXES })
  try {
    const stop = approach()
    page.move(150, 120, 0)
    for (let t = 16; t <= 400; t += 16) page.frame(t)
    assert.ok(Number(page.near.get("a")) > 0.5)
    page.leave(420)
    for (let t = 436; t <= 4000; t += 16) page.frame(t)
    assert.equal(page.near.get("a"), "0.000")
    stop()
  } finally { page.restore() }
})

test("a finger has no approach: touch lets go of what the pointer was lighting", () => {
  const page = standIn({ boxes: BOXES })
  try {
    const stop = approach()
    page.move(150, 120, 0)
    for (let t = 16; t <= 400; t += 16) page.frame(t)
    page.move(150, 120, 420, "touch")
    assert.equal(page.near.get("a"), "0.000")
    assert.equal(page.frame(436), 0, "touch asks for no frames")
    stop()
  } finally { page.restore() }
})

test("where the primary pointer is coarse it does nothing", () => {
  const page = standIn({ fine: false, boxes: BOXES })
  try {
    const stop = approach()
    assert.equal(page.listening(), 0)
    stop()
  } finally { page.restore() }
})

test("stopping it stops listening and clears every --near", () => {
  const page = standIn({ boxes: BOXES })
  try {
    const stop = approach()
    page.move(150, 120, 0)
    page.frame(16)
    assert.ok(page.near.size > 0)
    stop()
    assert.equal(page.listening(), 0)
    assert.equal(page.near.size, 0)
    assert.equal(page.frame(32), 0)
  } finally { page.restore() }
})

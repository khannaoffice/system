import { test } from "node:test"
import assert from "node:assert/strict"
import { B_MODULE, isOnLattice, lattice, nudge, place, rectOf, resize, snap, type Lattice, type Outcome, type Placement } from "../src/refusal.ts"

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const RULES = new Set(["whole-modules", "span", "origin", "pair", "columns", "overlap"])
const WILD: unknown[] = [0, 1, 2, 3, 5, 11, 12, 13, -1, -7, 0.5, 1.5, 2.0000001, -0, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 2, 1e300, "2", "", null, undefined, true, {}, []]
const wild = (r: () => number): unknown => (r() < 0.5 ? Math.floor(r() * 14) - 1 : WILD[Math.floor(r() * WILD.length)])
const intIn = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

function assertOnLattice(lat: Lattice, outcome: Outcome, others: Placement[], context: string) {
  if (!outcome.ok) {
    assert.ok(RULES.has(outcome.rule), `${context}: the refusal names a known rule`)
    assert.ok(outcome.message.length > 8, `${context}: and says it in words`)
    assert.equal("placement" in outcome, false, `${context}: a refusal carries no placement`)
    return
  }
  assert.equal("rule" in outcome, false, `${context}: a placement carries no refusal`)
  const { x, y, w, h } = outcome.placement
  for (const [name, v] of Object.entries({ x, y, w, h })) assert.ok(Number.isSafeInteger(v), `${context}: ${name} is a whole number (${v})`)
  assert.ok(x >= 0 && y >= 0 && w >= 1 && h >= 1, `${context}: inside the origin, spans of at least one`)
  assert.ok(x + w <= lat.columns, `${context}: inside the columns`)
  assert.equal(Object.is(x, -0) || Object.is(y, -0), false, `${context}: no negative zero`)
  for (const o of others) assert.ok(x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y, `${context}: shares no module with another`)
  const pitchX = (B_MODULE.w + B_MODULE.gapX) * lat.scale
  const pitchY = (B_MODULE.h + B_MODULE.gapY) * lat.scale
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
  assert.ok(near(outcome.rect.left, x * pitchX) && near(outcome.rect.top, y * pitchY), `${context}: starts on a module edge`)
  assert.ok(near(outcome.rect.width, w * B_MODULE.w * lat.scale + (w - 1) * B_MODULE.gapX * lat.scale), `${context}: as wide as w modules and the gaps between`)
  assert.ok(near(outcome.rect.height, h * B_MODULE.h * lat.scale + (h - 1) * B_MODULE.gapY * lat.scale), `${context}: as tall as h modules and the gaps between`)
  assert.ok(near(outcome.rect.left / pitchX, Math.round(outcome.rect.left / pitchX)), `${context}: left is a whole number of pitches`)
  assert.ok(near(outcome.rect.right, outcome.rect.left + outcome.rect.width), `${context}: right edge agrees`)
  assert.ok(Object.isFrozen(outcome.placement), `${context}: the placement cannot be edited off the lattice afterwards`)
}

const LATTICES: Lattice[] = [lattice(), lattice({ scale: 100 / 84 }), lattice({ columns: 4 }), lattice({ columns: 1, scale: 0.5 })]

test("A1-34.1 fuzz: every output of every placement API is on the lattice, or a refusal that names the rule", () => {
  let accepted = 0
  let refused = 0
  const seenRules = new Set<string>()
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed)
    const lat = LATTICES[seed % LATTICES.length]
    const others: Placement[] = []
    for (let step = 0; step < 14; step++) {
      const request = { x: r() < 0.25 ? undefined : wild(r), y: r() < 0.25 ? undefined : wild(r), w: r() < 0.2 ? undefined : wild(r), h: r() < 0.2 ? undefined : wild(r) }
      const out = place(lat, request, others)
      assertOnLattice(lat, out, others, `seed ${seed} place ${JSON.stringify(request)}`)
      if (out.ok) { accepted++; others.push(out.placement) } else { refused++; seenRules.add(out.rule) }
    }
    for (let step = 0; step < 10 && others.length; step++) {
      const i = intIn(r, 0, others.length - 1)
      const mine = others[i]
      const rest = others.filter((_, j) => j !== i)
      const which = intIn(r, 0, 3)
      let out: Outcome
      if (which === 0) out = nudge(lat, mine, wild(r), wild(r), rest)
      else if (which === 1) out = resize(lat, mine, wild(r), wild(r), rest)
      else if (which === 2) out = snap(lat, { left: (r() - 0.2) * 2000, top: (r() - 0.2) * 2000, width: r() * 800, height: r() * 800 }, rest)
      else out = snap(lat, { left: wild(r) as number, top: wild(r) as number, width: wild(r) as number, height: wild(r) as number }, rest)
      assertOnLattice(lat, out, rest, `seed ${seed} step ${step} op ${which}`)
      if (out.ok) { accepted++; others[i] = out.placement } else { refused++; seenRules.add(out.rule) }
    }
    for (const p of others) assertOnLattice(lat, { ok: true, placement: p, rect: rectOf(lat, p) }, others.filter((o) => o !== p), `seed ${seed} final`)
  }
  assert.ok(accepted > 5000 && refused > 10000, `${accepted} accepted, ${refused} refused`)
  assert.deepEqual([...seenRules].sort(), [...RULES].sort(), "the fuzz reached every rule")
})

test("A1-34.1 a placement off the lattice is refused, not flagged: the answer has no invalid form", () => {
  const lat = lattice()
  const cases: [unknown, string][] = [
    [{ x: 0.5, y: 0, w: 1, h: 1 }, "whole-modules"],
    [{ x: 0, y: 0, w: 1.5, h: 1 }, "whole-modules"],
    [{ x: NaN, y: 0, w: 1, h: 1 }, "whole-modules"],
    [{ x: "1", y: 0, w: 1, h: 1 }, "whole-modules"],
    [{ x: 0, y: 0, w: 0, h: 1 }, "span"],
    [{ x: 0, y: 0, w: 1, h: -2 }, "span"],
    [{ x: -1, y: 0, w: 1, h: 1 }, "origin"],
    [{ x: 0, y: -1, w: 1, h: 1 }, "origin"],
    [{ x: 3, w: 1, h: 1 }, "pair"],
    [{ y: 3, w: 1, h: 1 }, "pair"],
    [{ x: 11, y: 0, w: 2, h: 1 }, "columns"],
    [{ x: 0, y: 0, w: 13, h: 1 }, "columns"],
  ]
  for (const [request, rule] of cases) {
    const out = place(lat, request as never)
    assert.equal(out.ok, false, JSON.stringify(request))
    assert.equal((out as { rule: string }).rule, rule, JSON.stringify(request))
    assert.equal("placement" in out, false)
  }
  const first = place(lat, { x: 2, y: 1, w: 3, h: 2 })
  assert.ok(first.ok)
  const clash = place(lat, { x: 4, y: 2, w: 2, h: 2 }, [first.placement])
  assert.deepEqual(clash.ok ? null : clash.rule, "overlap")
  assert.ok(place(lat, { x: 5, y: 1, w: 2, h: 2 }, [first.placement]).ok)
  assert.ok(place(lat, { x: 2, y: 3, w: 3, h: 1 }, [first.placement]).ok)
})

test("A1-34.1 the lattice is the B-module, and a site's uniform scale keeps its proportions", () => {
  const base = lattice()
  assert.deepEqual([base.module.w, base.module.h, base.gap.x, base.gap.y, base.columns], [84, 80, 12, 10, 12])
  const site = lattice({ scale: 100 / 84 })
  assert.ok(Math.abs(site.module.w - 100) < 1e-9)
  assert.ok(Math.abs(site.module.h - 95.238) < 1e-3)
  assert.ok(Math.abs(site.gap.x - 14.286) < 1e-3 && Math.abs(site.gap.y - 11.905) < 1e-3)
  assert.ok(Math.abs(site.module.w / site.module.h - 84 / 80) < 1e-12, "84 : 80 holds at any scale")
  assert.ok(Math.abs(site.gap.x / site.gap.y - 12 / 10) < 1e-12)
  const a = place(base, { x: 2, y: 3, w: 4, h: 2 })
  const b = place(site, { x: 2, y: 3, w: 4, h: 2 })
  assert.ok(a.ok && b.ok)
  assert.deepEqual([a.placement.x, a.placement.y, a.placement.w, a.placement.h], [b.placement.x, b.placement.y, b.placement.w, b.placement.h])
  assert.ok(Math.abs(b.rect.left / a.rect.left - site.scale) < 1e-9)
  assert.throws(() => lattice({ scale: 0 }), /scale/)
  assert.throws(() => lattice({ columns: 2.5 }), /columns/)
})

test("A1-34.1 flow placement finds the first free place in reading order, never an invalid one", () => {
  const lat = lattice({ columns: 4 })
  let layout: Placement[] = []
  for (let i = 0; i < 20; i++) {
    const out = place(lat, { w: 1 + (i % 3), h: 1 }, layout)
    assert.ok(out.ok)
    layout = [...layout, out.placement]
  }
  layout.forEach((p, i) => {
    assert.ok(p.x + p.w <= 4)
    layout.slice(i + 1).forEach((q) => assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y))
  })
  const first = place(lat, { w: 2, h: 1 })
  assert.ok(first.ok && first.placement.x === 0 && first.placement.y === 0)
  assert.equal(place(lat, { w: 5 }).ok, false, "wider than the columns")
})

test("A1-34.1 flow placement equals a cell-by-cell search, and does not hang on a far-down neighbour", () => {
  const lat = lattice({ columns: 5 })
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed)
    const layout: Placement[] = []
    for (let i = 0; i < 6; i++) {
      const o = place(lat, { x: intIn(r, 0, 4), y: intIn(r, 0, 6), w: intIn(r, 1, 3), h: intIn(r, 1, 3) }, layout)
      if (o.ok) layout.push(o.placement)
    }
    const w = intIn(r, 1, 4)
    const h = intIn(r, 1, 3)
    let expected: [number, number] | null = null
    for (let y = 0; y < 30 && !expected; y++) for (let x = 0; x + w <= 5 && !expected; x++) {
      if (layout.every((o) => x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y)) expected = [x, y]
    }
    const got = place(lat, { w, h }, layout)
    assert.ok(got.ok)
    assert.deepEqual([got.placement.x, got.placement.y], expected, `case ${seed}`)
  }
  const far = place(lat, { x: 0, y: 1_000_000_000_000, w: 1, h: 1 })
  assert.ok(far.ok)
  const flowed = place(lat, { w: 2, h: 1 }, [far.placement])
  assert.ok(flowed.ok && flowed.placement.y === 0, "found at the top, at once")
})

test("A1-34.1 snap takes a drawn rectangle to the nearest module, and moves and resizes stay whole", () => {
  const lat = lattice()
  const pitchX = 96
  const pitchY = 90
  const s = snap(lat, { left: 2 * pitchX + 20, top: 1 * pitchY - 30, width: 3 * 84 + 2 * 12 + 15, height: 80 - 20 })
  assert.ok(s.ok)
  assert.deepEqual([s.placement.x, s.placement.y, s.placement.w, s.placement.h], [2, 1, 3, 1])
  assert.equal(snap(lat, { left: -400, top: 0, width: 80, height: 80 }).ok, false, "off the left edge is refused, not clamped")
  assert.equal(snap(lat, { left: NaN, top: 0, width: 80, height: 80 }).ok, false)
  const p = (place(lat, { x: 0, y: 0, w: 2, h: 2 }) as { placement: Placement }).placement
  const moved = nudge(lat, p, 3, 1)
  assert.ok(moved.ok && moved.placement.x === 3 && moved.placement.y === 1)
  assert.equal(nudge(lat, p, -1, 0).ok, false, "past the first column")
  assert.equal(nudge(lat, p, 0.5, 0).ok, false)
  assert.equal(nudge(lat, p, 11, 0).ok, false, "past the last column")
  const grown = resize(lat, p, 1, 0)
  assert.ok(grown.ok && grown.placement.w === 3)
  assert.equal(resize(lat, p, -2, 0).ok, false, "a span of zero")
})

test("A1-34.1 isOnLattice agrees with place for data that arrives from outside", () => {
  const lat = lattice()
  for (let seed = 1; seed <= 2000; seed++) {
    const r = rng(seed)
    const v = { x: wild(r), y: wild(r), w: wild(r), h: wild(r) }
    if (Object.values(v).includes(undefined)) continue
    assert.equal(isOnLattice(lat, v), place(lat, v).ok, JSON.stringify(v))
  }
  assert.equal(isOnLattice(lat, null), false)
  assert.equal(isOnLattice(lat, 3), false)
})

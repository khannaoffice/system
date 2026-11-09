import { test } from "node:test"
import assert from "node:assert/strict"
import { announce, apply, countChanges, diff, durationOf, frames, interrupt, longestIncreasing, play, present, type Row, type State } from "../src/within.ts"
import { shuffled } from "./helpers.ts"

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function randomPair(seed: number): { before: State<string>; after: State<string> } {
  const r = rng(seed)
  const pick = (n: number) => Math.floor(r() * n)
  const size = pick(14)
  const ids = Array.from({ length: size + 6 }, (_, i) => `ko-${seed.toString(36)}${i.toString(36).padStart(2, "0")}`)
  const value = () => `v${pick(3)}`
  const before: State<string> = ids.slice(0, size).map((id) => ({ id, value: value() }))
  let after: State<string> = before.filter(() => r() > 0.25).map((row) => ({ id: row.id, value: r() > 0.7 ? value() : row.value }))
  after = shuffled(after, seed + 1)
  if (r() > 0.5) after = after.slice().reverse().slice(pick(after.length + 1)).reverse()
  const fresh = ids.slice(size).slice(0, pick(5))
  for (const id of fresh) after.splice(pick(after.length + 1), 0, { id, value: value() })
  if (r() > 0.9) after = []
  return { before, after }
}

const rows = (...ids: string[]): State<string> => ids.map((id) => ({ id, value: "same" }))
const ids = (s: State) => s.map((r) => r.id)

test("A1-33.2 applying the moves to the old state yields the new state exactly (many random cases)", () => {
  let moved = 0
  let inserted = 0
  let removed = 0
  let duplicateValues = 0
  for (let seed = 1; seed <= 4000; seed++) {
    const { before, after } = randomPair(seed)
    const set = diff(before, after)
    assert.deepEqual(apply(before, set), after, `case ${seed}`)
    for (const c of set.changes) {
      if (c.kind === "move") moved++
      if (c.kind === "insert") inserted++
      if (c.kind === "remove") removed++
    }
    if (new Set(after.map((r) => r.value)).size < after.length) duplicateValues++
  }
  assert.ok(moved > 2000 && inserted > 2000 && removed > 2000 && duplicateValues > 2000, `${moved} ${inserted} ${removed} ${duplicateValues}`)
})

test("A1-33.2 the set of moves is minimal: no fewer moves could produce the new order", () => {
  for (let seed = 1; seed <= 1500; seed++) {
    const { before, after } = randomPair(seed)
    const set = diff(before, after)
    const rank = new Map(after.filter((r) => before.some((b) => b.id === r.id)).map((r, i) => [r.id, i]))
    const seq = before.filter((r) => rank.has(r.id)).map((r) => rank.get(r.id)!)
    const best = seq.map(() => 1)
    for (let i = 0; i < seq.length; i++) for (let j = 0; j < i; j++) if (seq[j] < seq[i]) best[i] = Math.max(best[i], best[j] + 1)
    const longest = seq.length ? Math.max(...best) : 0
    assert.equal(set.changes.filter((c) => c.kind === "move").length, seq.length - longest, `case ${seed}`)
    assert.equal(longestIncreasing(seq).length, longest, `case ${seed}: the subsequence helper`)
  }
})

test("A1-33.2 moves are computed from identities, not from position alone", () => {
  const swapped = diff(rows("a", "b"), rows("b", "a"))
  assert.equal(swapped.changes.length, 1)
  assert.equal(swapped.changes[0].kind, "move")
  const replaced = diff(rows("a"), rows("b"))
  assert.deepEqual(replaced.changes.map((c) => [c.kind, c.id]), [["remove", "a"], ["insert", "b"]])
  const both = diff([{ id: "a", value: "1" }, { id: "b", value: "1" }], [{ id: "b", value: "2" }, { id: "a", value: "1" }])
  assert.deepEqual(both.changes.map((c) => c.kind).sort(), ["change", "move"])
  assert.deepEqual(apply([{ id: "a", value: "1" }, { id: "b", value: "1" }], both), [{ id: "b", value: "2" }, { id: "a", value: "1" }])
})

test("A1-33.2 a state that names an identity twice is refused, not guessed at", () => {
  assert.throws(() => diff(rows("a", "a"), rows("a")), /appears twice/)
  assert.throws(() => diff(rows("a"), rows("b", "b")), /appears twice/)
  assert.throws(() => diff([{ id: "", value: 1 }], []), /no identity/)
})

test("A1-33.1 unchanged identities produce no move", () => {
  assert.deepEqual(diff(rows("a", "b", "c"), rows("a", "b", "c")).changes, [])
  const set = diff(rows("a", "b", "c", "d"), rows("x", "b", "y", "d", "z"))
  assert.deepEqual(set.changes.filter((c) => c.kind === "move"), [])
  assert.deepEqual(countChanges(set), { moved: 0, added: 3, removed: 2, changed: 0 })
  for (let seed = 1; seed <= 1000; seed++) {
    const { before, after } = randomPair(seed)
    const named = new Set(diff(before, after).changes.filter((c) => c.kind === "move").map((c) => c.id))
    const stay = (s: State) => ids(s).filter((id) => !named.has(id) && before.some((b) => b.id === id) && after.some((a) => a.id === id))
    assert.deepEqual(stay(before), stay(after), `case ${seed}`)
  }
})

test("A1-33.1 only what changes moves, and a move is as long as its displacement", () => {
  const before = rows("a", "b", "c", "d", "e", "f", "g", "h")
  const far = diff(before, rows("b", "c", "d", "e", "f", "g", "h", "a"))
  assert.equal(far.changes.length, 1)
  assert.deepEqual(far.changes[0], { kind: "move", id: "a", from: 0, to: 7, distance: 7 })
  const one = diff(before, rows("a", "c", "b", "d", "e", "f", "g", "h"))
  assert.equal(one.changes.length, 1)
  assert.equal((one.changes[0] as { distance: number }).distance, 1)
  for (let k = 1; k <= 7; k++) {
    const order = ids(before).filter((id) => id !== "a")
    order.splice(k, 0, "a")
    const set = diff(before, order.map((id) => ({ id, value: "same" })))
    assert.equal(set.changes.length, 1)
    assert.equal((set.changes[0] as { distance: number }).distance, k)
  }
  const noisy = diff(rows("x", "a", "b", "c", "d"), rows("b", "c", "d", "n", "a"))
  const move = noisy.changes.find((c) => c.kind === "move") as { distance: number }
  assert.equal(move.distance, 3)
  const update = diff([{ id: "a", value: 1 }, { id: "b", value: 2 }], [{ id: "a", value: 1 }, { id: "b", value: 3 }])
  assert.deepEqual(update.changes, [{ kind: "change", id: "b", before: 2, after: 3 }])
})

test("A1-33.1 value changes compare by content, not by object identity", () => {
  const same = diff([{ id: "a", value: { n: 1, tags: ["x"] } }], [{ id: "a", value: { tags: ["x"], n: 1 } }])
  assert.deepEqual(same.changes, [])
})

test("A1-33.3 any input during a move finishes the remainder at once, at speed", () => {
  const before = rows("a", "b", "c", "d", "e", "f")
  const after = rows("f", "a", "b", "c", "d", "e")
  const set = diff(before, after)
  const player = play(before, set, 1000, { msPerPlace: 40, hurry: 8 })
  assert.equal(durationOf(player, set.changes[0]), 5 * 40, "a move lasts as many places as it travels")
  const mid = frames(player, 1100)
  assert.equal(mid.done, false)
  assert.equal(mid.frames[0].progress, 0.5)
  const cut = interrupt(player, 1100)
  assert.deepEqual(cut.state, after, "the surface is at its destination the moment the input arrives")
  assert.deepEqual(cut.remaining, ["f"])
  assert.equal(cut.remainderMs, (200 - 100) / 8, "what was left plays eight times faster")
  assert.equal(interrupt(player, 1000).remainderMs, 200 / 8)
  const late = interrupt(player, 5000)
  assert.deepEqual(late.state, after)
  assert.deepEqual(late.remaining, [])
  assert.equal(late.remainderMs, 0)
  assert.equal(frames(player, 1200).done, true)
  for (let seed = 1; seed <= 500; seed++) {
    const pair = randomPair(seed)
    const p = play(pair.before, diff(pair.before, pair.after), 0, { msPerPlace: 30 })
    for (const t of [0, 10, 100, 1000]) assert.deepEqual(interrupt(p, t).state, pair.after, `case ${seed} at ${t}`)
  }
  assert.throws(() => play(before, set, 0, { msPerPlace: 0 }), /positive/)
})

test("A1-33.4 the change is announced in words, and the no-motion path says the same thing", () => {
  const before = rows("a", "b", "c", "d", "e")
  const after = rows("c", "d", "e", "a", "n")
  const set = diff(before, after)
  assert.equal(announce(diff(rows("a", "b", "c", "d"), rows("b", "c", "d", "a"))), "1 moved.")
  assert.equal(announce(diff(rows("a", "b", "c", "d"), rows("d", "c", "b", "a", "e"))), "3 moved, 1 added.")
  assert.equal(announce(diff(rows("a"), rows("a"))), "Nothing changed.")
  assert.equal(announce(diff(rows("a", "b"), rows("b"))), "1 removed.")
  assert.equal(announce(diff([{ id: "a", value: 1 }], [{ id: "a", value: 2 }])), "1 changed.")
  assert.deepEqual(countChanges(set), { moved: 1, added: 1, removed: 1, changed: 0 })
  assert.equal(announce(set), "1 moved, 1 added, 1 removed.")
  const names: Record<string, string> = { a: "Index", b: "Threads" }
  assert.equal(announce(diff(rows("a", "b", "c"), rows("b", "c", "a")), (id) => names[id] ?? id), "Index moved 2 places.")
  const quiet = present(before, after, { motion: false })
  const lively = present(before, after, { motion: true })
  assert.deepEqual(quiet.state, after)
  assert.deepEqual(quiet.state, lively.state)
  assert.equal(quiet.announcement, lively.announcement)
  assert.equal(quiet.animate, false)
  assert.equal(lively.animate, true)
  assert.equal(present(before, before, { motion: true }).animate, false, "nothing to animate when nothing changed")
  for (let seed = 1; seed <= 500; seed++) {
    const { before: b, after: a } = randomPair(seed)
    const p = present(b, a, { motion: false })
    const c = countChanges(p.set)
    const words = [c.moved && `${c.moved} moved`, c.added && `${c.added} added`, c.removed && `${c.removed} removed`, c.changed && `${c.changed} changed`].filter(Boolean)
    assert.equal(p.announcement, words.length ? `${words.join(", ")}.` : "Nothing changed.")
    assert.deepEqual(p.state, a)
  }
})

test("A1-33.2 a change set that does not belong to the state is refused", () => {
  assert.throws(() => apply(rows("a"), { changes: [{ kind: "remove", id: "zz", from: 0 }] }), /not in the old state/)
  assert.throws(() => apply(rows("a"), { changes: [{ kind: "insert", id: "a", to: 0 }] }), /already in the old state/)
})

test("rows keep their values through a diff and back, for rows without a value too", () => {
  const before: State = [{ id: "a" }, { id: "b", value: null }]
  const after: State = [{ id: "b", value: null }, { id: "a" }, { id: "c" }]
  assert.deepEqual(apply(before, diff(before, after)), after)
  const r: Row = { id: "x" }
  assert.equal("value" in r, false)
})

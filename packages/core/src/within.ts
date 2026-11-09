import { canonicalJson } from "./core.ts"

export interface Row<V = unknown> {
  id: string
  value?: V
}

export type State<V = unknown> = Row<V>[]

export type Change<V = unknown> =
  | { kind: "insert"; id: string; to: number; value?: V }
  | { kind: "remove"; id: string; from: number; value?: V }
  | { kind: "move"; id: string; from: number; to: number; distance: number }
  | { kind: "change"; id: string; before?: V; after?: V }

export interface MoveSet<V = unknown> {
  changes: Change<V>[]
}

const same = (a: unknown, b: unknown) => a === b || canonicalJson(a) === canonicalJson(b)

function indexById<V>(state: State<V>, which: string): Map<string, number> {
  const index = new Map<string, number>()
  state.forEach((row, i) => {
    if (typeof row.id !== "string" || row.id === "") throw new TypeError(`${which} state: row ${i} has no identity`)
    if (index.has(row.id)) throw new TypeError(`${which} state: identity "${row.id}" appears twice`)
    index.set(row.id, i)
  })
  return index
}

export function longestIncreasing(seq: number[]): number[] {
  const tails: number[] = []
  const prev: number[] = new Array(seq.length).fill(-1)
  seq.forEach((value, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (seq[tails[mid]] < value) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  })
  const out: number[] = []
  for (let at = tails.length ? tails[tails.length - 1] : -1; at >= 0; at = prev[at]) out.push(at)
  return out.reverse()
}

export function diff<V = unknown>(before: State<V>, after: State<V>): MoveSet<V> {
  const oldAt = indexById(before, "old")
  const newAt = indexById(after, "new")

  const survivors = before.filter((row) => newAt.has(row.id))
  const survivorsNewOrder = after.filter((row) => oldAt.has(row.id))
  const newRank = new Map(survivorsNewOrder.map((row, rank) => [row.id, rank]))
  const stays = new Set(longestIncreasing(survivors.map((row) => newRank.get(row.id)!)).map((i) => survivors[i].id))

  const removes: Change<V>[] = []
  const moves: Change<V>[] = []
  const inserts: Change<V>[] = []
  const changes: Change<V>[] = []

  before.forEach((row, from) => {
    if (!newAt.has(row.id)) removes.push({ kind: "remove", id: row.id, from, ...(row.value !== undefined ? { value: row.value } : {}) })
  })
  survivors.forEach((row, oldRank) => {
    if (stays.has(row.id)) return
    moves.push({ kind: "move", id: row.id, from: oldAt.get(row.id)!, to: newAt.get(row.id)!, distance: Math.abs(newRank.get(row.id)! - oldRank) })
  })
  after.forEach((row, to) => {
    const was = oldAt.get(row.id)
    if (was === undefined) inserts.push({ kind: "insert", id: row.id, to, ...(row.value !== undefined ? { value: row.value } : {}) })
    else if (!same(before[was].value, row.value)) changes.push({ kind: "change", id: row.id, before: before[was].value, after: row.value })
  })
  moves.sort((a, b) => (a as { to: number }).to - (b as { to: number }).to)
  return { changes: [...removes, ...moves, ...inserts, ...changes] }
}

export function apply<V = unknown>(before: State<V>, set: MoveSet<V>): State<V> {
  const gone = new Set<string>()
  const edited = new Map<string, Change<V> & { kind: "change" }>()
  const placed = new Map<number, Row<V>>()
  const mover = new Map<string, number>()
  const known = new Set(before.map((row) => row.id))
  for (const c of set.changes) {
    if (c.kind === "remove") {
      if (!known.has(c.id)) throw new Error(`cannot remove "${c.id}": it is not in the old state`)
      gone.add(c.id)
    } else if (c.kind === "change") {
      if (!known.has(c.id)) throw new Error(`cannot change "${c.id}": it is not in the old state`)
      edited.set(c.id, c)
    } else if (c.kind === "move") {
      if (!known.has(c.id)) throw new Error(`cannot move "${c.id}": it is not in the old state`)
      mover.set(c.id, c.to)
    } else {
      if (known.has(c.id)) throw new Error(`cannot insert "${c.id}": it is already in the old state`)
      if (placed.has(c.to)) throw new Error(`two rows are placed at ${c.to}`)
      placed.set(c.to, c.value === undefined ? { id: c.id } : { id: c.id, value: c.value })
    }
  }
  const kept: Row<V>[] = []
  for (const row of before) {
    if (gone.has(row.id)) continue
    const edit = edited.get(row.id)
    const next: Row<V> = edit ? (edit.after === undefined ? { id: row.id } : { id: row.id, value: edit.after }) : row
    const to = mover.get(row.id)
    if (to !== undefined) {
      if (placed.has(to)) throw new Error(`two rows are placed at ${to}`)
      placed.set(to, next)
    } else kept.push(next)
  }
  const size = kept.length + placed.size
  const out: State<V> = []
  let k = 0
  for (let i = 0; i < size; i++) {
    const row = placed.get(i) ?? kept[k++]
    if (!row) throw new Error("the change set leaves a gap")
    out.push(row)
  }
  for (const to of placed.keys()) if (to < 0 || to >= size) throw new Error(`place ${to} is outside the new state`)
  return out
}

export interface Counts {
  moved: number
  added: number
  removed: number
  changed: number
}

export function countChanges(set: MoveSet): Counts {
  const counts: Counts = { moved: 0, added: 0, removed: 0, changed: 0 }
  for (const c of set.changes) counts[{ move: "moved", insert: "added", remove: "removed", change: "changed" }[c.kind] as keyof Counts] += 1
  return counts
}

export function announce(set: MoveSet, name?: (id: string) => string): string {
  const total = set.changes.length
  if (total === 0) return "Nothing changed."
  if (total === 1 && name) {
    const c = set.changes[0]
    const who = name(c.id)
    if (c.kind === "move") return `${who} moved ${c.distance} ${c.distance === 1 ? "place" : "places"}.`
    if (c.kind === "insert") return `${who} added.`
    if (c.kind === "remove") return `${who} removed.`
    return `${who} changed.`
  }
  const counts = countChanges(set)
  const parts = (["moved", "added", "removed", "changed"] as const).filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${k}`)
  return `${parts.join(", ")}.`
}

export function present<V = unknown>(before: State<V>, after: State<V>, options: { motion: boolean; name?: (id: string) => string }) {
  const set = diff(before, after)
  const state = apply(before, set)
  return { set, state, announcement: announce(set, options.name), animate: options.motion && set.changes.length > 0 }
}

export interface PlayerOptions {
  msPerPlace: number
  hurry?: number
}

export interface Player<V = unknown> {
  before: State<V>
  set: MoveSet<V>
  startedAt: number
  msPerPlace: number
  hurry: number
}

export function play<V = unknown>(before: State<V>, set: MoveSet<V>, now: number, options: PlayerOptions): Player<V> {
  if (!(Number.isFinite(options.msPerPlace) && options.msPerPlace > 0)) throw new RangeError("msPerPlace must be a positive number")
  const hurry = options.hurry ?? 8
  if (!(Number.isFinite(hurry) && hurry >= 1)) throw new RangeError("hurry must be at least 1")
  return { before, set, startedAt: now, msPerPlace: options.msPerPlace, hurry }
}

export const durationOf = (player: Pick<Player, "msPerPlace">, change: Change) =>
  (change.kind === "move" ? change.distance : 1) * player.msPerPlace

export interface Frame {
  id: string
  kind: Change["kind"]
  progress: number
}

export function frames(player: Player, now: number): { frames: Frame[]; done: boolean } {
  const elapsed = Math.max(0, now - player.startedAt)
  const out = player.set.changes.map((c) => ({ id: c.id, kind: c.kind, progress: Math.min(1, elapsed / durationOf(player, c)) }))
  return { frames: out, done: out.every((f) => f.progress >= 1) }
}

export function interrupt<V = unknown>(player: Player<V>, now: number): { state: State<V>; remaining: string[]; remainderMs: number } {
  const elapsed = Math.max(0, now - player.startedAt)
  let left = 0
  const remaining: string[] = []
  for (const c of player.set.changes) {
    const rest = durationOf(player, c) - elapsed
    if (rest > 0) {
      remaining.push(c.id)
      left = Math.max(left, rest)
    }
  }
  return { state: apply(player.before, player.set), remaining, remainderMs: left / player.hurry }
}

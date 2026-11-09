export type Bezier = readonly [number, number, number, number]

export interface Cadence {
  readonly baseMs: number
  duration(n: number): number
  tick(n: number): number
  pulse(n: number): number
  easing(name: string): string
  readonly easings: Readonly<Record<string, Bezier>>
  stepped(name: string): string
  readonly steppings: Readonly<Record<string, Steps>>
}

export interface Steps {
  readonly steps: number
  readonly position: "jump-start" | "jump-end" | "jump-none" | "jump-both"
}

const STEP_POSITIONS: Readonly<Record<string, Steps["position"]>> = {
  start: "jump-start", end: "jump-end", "jump-start": "jump-start", "jump-end": "jump-end", "jump-none": "jump-none", "jump-both": "jump-both",
}

export const stepsCss = (s: Steps): string => `steps(${s.steps}, ${s.position})`

export function parseSteps(css: string): Steps | null {
  const text = css.trim().toLowerCase()
  if (text === "step-start") return { steps: 1, position: "jump-start" }
  if (text === "step-end") return { steps: 1, position: "jump-end" }
  const m = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/.exec(text)
  if (!m) return null
  const position = STEP_POSITIONS[m[2] ?? "end"]
  const steps = Number(m[1])
  if (!position || steps < 1 || (position === "jump-none" && steps < 2)) return null
  return { steps, position }
}

export const CSS_EASINGS: Readonly<Record<string, Bezier>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
}

export const cubicBezier = (b: Bezier): string => `cubic-bezier(${b.join(", ")})`

function multiple(baseMs: number, n: number, what: string): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${what} must be a whole number of base units, not ${n}`)
  return baseMs * n
}

export function cadence(baseMs: number, easings: Readonly<Record<string, Bezier>>, steppings: Readonly<Record<string, Steps>> = {}): Cadence {
  if (!Number.isFinite(baseMs) || baseMs <= 0) throw new RangeError("the base unit must be a positive number of ms")
  for (const [name, b] of Object.entries(easings)) {
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) {
      throw new RangeError(`easing "${name}" is not a cubic-bezier (x values must be within 0 and 1)`)
    }
  }
  for (const [name, st] of Object.entries(steppings)) {
    if (!parseSteps(stepsCss(st))) throw new RangeError(`stepped timing "${name}" is not a CSS steps() function`)
  }
  return {
    baseMs,
    duration: (n) => multiple(baseMs, n, "a duration"),
    tick: (n) => multiple(baseMs, n, "a tick interval"),
    pulse: (n) => multiple(baseMs, n, "a pulse"),
    easing(name) {
      const b = easings[name]
      if (!b) throw new RangeError(`no easing named "${name}" is declared`)
      return cubicBezier(b)
    },
    easings: { ...easings },
    stepped(name) {
      const st = steppings[name]
      if (!st) throw new RangeError(`no stepped timing named "${name}" is declared`)
      return stepsCss(st)
    },
    steppings: { ...steppings },
  }
}

export interface DeclaredMotion {
  name: string
  ms?: number
  delayMs?: number
  easing?: string
}

export interface Stray {
  name: string
  field: "ms" | "delayMs" | "easing"
  value: number | string
  reason: "not-a-multiple" | "undeclared-easing" | "unparsable-easing"
  nearestMs?: number
  relativeError?: number
}

export function parseEasing(css: string): Bezier | null {
  const text = css.trim().toLowerCase()
  const keyword = CSS_EASINGS[text]
  if (keyword) return keyword
  const m = /^cubic-bezier\(\s*([^)]*)\)$/.exec(text)
  if (!m) return null
  const parts = m[1].split(",").map((p) => p.trim())
  if (parts.length !== 4 || parts.some((p) => p === "")) return null
  const nums = parts.map(Number)
  return nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2], nums[3]] : null
}

const same = (a: Bezier, b: Bezier) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

export function nearestMultiple(baseMs: number, ms: number): number {
  if (ms === 0) return 0
  const down = Math.max(1, Math.floor(ms / baseMs)) * baseMs
  const up = Math.max(1, Math.ceil(ms / baseMs)) * baseMs
  return Math.abs(ms - down) <= Math.abs(up - ms) ? down : up
}

export function checkMotion(c: Cadence, declared: readonly DeclaredMotion[]): Stray[] {
  const strays: Stray[] = []
  const known = Object.values(c.easings)
  for (const d of declared) {
    for (const field of ["ms", "delayMs"] as const) {
      const v = d[field]
      if (v === undefined) continue
      const ratio = v / c.baseMs
      if (!(Number.isFinite(v) && v >= 0 && Math.abs(ratio - Math.round(ratio)) < 1e-9)) {
        const nearest = Number.isFinite(v) && v >= 0 ? nearestMultiple(c.baseMs, v) : undefined
        strays.push({ name: d.name, field, value: v, reason: "not-a-multiple", ...(nearest !== undefined ? { nearestMs: nearest, relativeError: v === 0 ? 0 : Math.abs(nearest - v) / v } : {}) })
      }
    }
    if (d.easing !== undefined) {
      const b = parseEasing(d.easing)
      const st = b ? null : parseSteps(d.easing)
      if (st) {
        if (!Object.values(c.steppings).some((k) => k.steps === st.steps && k.position === st.position)) strays.push({ name: d.name, field: "easing", value: d.easing, reason: "undeclared-easing" })
      } else if (!b) strays.push({ name: d.name, field: "easing", value: d.easing, reason: "unparsable-easing" })
      else if (!known.some((k) => same(k, b))) strays.push({ name: d.name, field: "easing", value: d.easing, reason: "undeclared-easing" })
    }
  }
  return strays
}

export type Value = string | number | boolean
export type State = Readonly<Record<string, Value>>

export interface Surface {
  id: string
  rest: State
}

export interface MotionType {
  name: string
  ends: State
}

export interface Running {
  id: string
  type: string
}

export interface RestProblem {
  motion: string
  reason: "unknown-type" | "does-not-end-at-rest"
  fields: string[]
}

const differing = (rest: State, now: State): string[] => Object.keys(rest).filter((k) => now[k] !== rest[k])

export function motionTypesThatDoNotRest(surface: Surface, types: readonly MotionType[]): RestProblem[] {
  return types.flatMap((t) => {
    const fields = differing(surface.rest, t.ends)
    return fields.length > 0 ? [{ motion: t.name, reason: "does-not-end-at-rest" as const, fields }] : []
  })
}

export interface RestStatus {
  atRest: boolean
  returns: { finish: string[]; set: Record<string, Value> }
  problems: RestProblem[]
}

export function restStatus(surface: Surface, current: State, running: readonly Running[], types: readonly MotionType[]): RestStatus {
  const byName = new Map(types.map((t) => [t.name, t]))
  const problems: RestProblem[] = []
  for (const r of running) {
    const t = byName.get(r.type)
    if (!t) problems.push({ motion: r.id, reason: "unknown-type", fields: [] })
    else {
      const fields = differing(surface.rest, t.ends)
      if (fields.length > 0) problems.push({ motion: r.id, reason: "does-not-end-at-rest", fields })
    }
  }
  const off = differing(surface.rest, current)
  const set: Record<string, Value> = {}
  for (const k of off) set[k] = surface.rest[k]
  return { atRest: running.length === 0 && off.length === 0, returns: { finish: running.map((r) => r.id), set }, problems }
}

export interface PlannedMotion {
  type: string
  final: State
  announcement: string
  durationMs: number
  easing?: string
}

export interface ReducedMotion {
  motion: State
  durationMs: 0
  final: State
  announcement: string
}

export function reduceMotion(surface: Surface, plan: PlannedMotion): ReducedMotion {
  return { motion: { ...surface.rest }, durationMs: 0, final: { ...plan.final }, announcement: plan.announcement }
}

export function informationLost(plan: PlannedMotion, reduced: ReducedMotion): { fields: string[]; announcement: boolean } {
  return {
    fields: Object.keys(plan.final).filter((k) => !(k in reduced.final) || reduced.final[k] !== plan.final[k]),
    announcement: plan.announcement !== reduced.announcement,
  }
}

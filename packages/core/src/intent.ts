import { CAPABILITIES } from "./capabilities.ts"
import { distanceToBox, ease, follow, rest, score, share, smoothstep, type Box, type Feel, type Pointer } from "./reading.ts"

export type Mode = "pointer" | "pen" | "touch" | "keyboard" | "voice" | "gaze" | "switch"
export const MODES: readonly Mode[] = ["pointer", "pen", "touch", "keyboard", "voice", "gaze", "switch"]

export const GRAMMAR = [
  "Discover", "Enter", "Locate", "Inspect", "Traverse", "Order", "Filter", "Compare", "Gather",
  "Annotate", "Transform", "Revise", "Share", "Delegate", "Execute", "Revoke", "Return", "Audit",
] as const
export type Verb = (typeof GRAMMAR)[number]

export const CAPABILITY_FOR: Partial<Record<Verb, string>> = {
  Inspect: "ko_read_object",
  Enter: "ko_set_position",
  Locate: "ko_set_position",
}

export interface Operation {
  operation: Verb
  target: string
  via: string
}

export interface Intent {
  target: string
  certainty: number
}

export function clampCertainty(n: number): number {
  if (Number.isNaN(n)) throw new RangeError("certainty is NaN")
  return Math.min(1, Math.max(0, n))
}

export function intent(target: string, certainty: number): Intent {
  return { target, certainty: clampCertainty(certainty) }
}

export function reading(i: Intent): number {
  return i.certainty
}
export function present<T>(i: Intent, presentation: (n: number) => T): T {
  return presentation(reading(i))
}

export interface Step<S> {
  state: S
  intents: Intent[]
  operations: Operation[]
}

export interface Adapter<S, I> {
  mode: Mode
  constants: Readonly<Record<string, number>>
  init(): S
  step(state: S, input: I, now: number): Step<S>
  release(state: S): Step<S>
}

export interface Target {
  id: string
  box: Box
}

type Widen<T> = { [K in keyof T]: number }

const ids = (xs: readonly Intent[]) => xs.filter((i) => i.certainty > 0).map((i) => i.target)
function settle(lit: readonly string[], next: Intent[]): Intent[] {
  const named = new Set(next.map((i) => i.target))
  return [...next, ...lit.filter((t) => !named.has(t)).map((t) => intent(t, 0))]
}
const op = (operation: Verb, target: string, via: string): Operation => ({ operation, target, via })

export const POINTER_FEEL: Readonly<Feel> = {
  lookahead: 160, maxLead: 140, fullSpeed: 0.6, velocityTau: 70, restTau: 90, riseTau: 85, fallTau: 160, share: 10,
}
export const POINTER_TIMING = {
  stillAfter: 30,
  longestFrame: 50,
  longestGap: 100,
  firstFrame: 1000 / 60,
  stillSpeed: 0.002,
} as const
export const PEN_FEEL: Readonly<Feel> = { ...POINTER_FEEL }
export const PEN_TIMING = { ...POINTER_TIMING }

export type PointerInput =
  | { mode: "pointer"; type: "move"; x: number; y: number }
  | { mode: "pointer"; type: "leave" }
  | { mode: "pointer"; type: "frame"; targets: readonly Target[] }
  | { mode: "pointer"; type: "press"; target: string }
  | { mode: "pointer"; type: "secondary"; target: string }

export type PenInput =
  | { mode: "pen"; type: "move"; x: number; y: number; height: number }
  | { mode: "pen"; type: "leave" }
  | { mode: "pen"; type: "frame"; targets: readonly Target[] }
  | { mode: "pen"; type: "press"; target: string }
  | { mode: "pen"; type: "secondary"; target: string }

export interface PointerState {
  pointer: Pointer
  lastEvent: number
  lastFrame: number
  shown: Record<string, number>
  awake: boolean
  height: number
}

const FAR_AWAY: Pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0 }
const freshPointer = (): PointerState => ({ pointer: FAR_AWAY, lastEvent: 0, lastFrame: 0, shown: {}, awake: false, height: 0 })

export function hoverFactor(height: number): number {
  return smoothstep(1 - height)
}

type Reader = { feel: Feel; timing: Widen<typeof POINTER_TIMING>; radius: number; hover: boolean; mode: "pointer" | "pen" }

function readStep(r: Reader, s: PointerState, input: PointerInput | PenInput, now: number): Step<PointerState> {
  const none = (state: PointerState): Step<PointerState> => ({ state, intents: [], operations: [] })
  switch (input.type) {
    case "move": {
      const dt = now - s.lastEvent
      const pointer =
        s.lastEvent && dt > 0 && dt < r.timing.longestGap
          ? follow(s.pointer, input.x, input.y, dt, r.feel)
          : { x: input.x, y: input.y, vx: 0, vy: 0 }
      const height = r.hover && "height" in input ? Math.min(1, Math.max(0, input.height)) : s.height
      return none({ ...s, pointer, lastEvent: now, awake: true, height })
    }
    case "leave":
      return none({ ...s, pointer: FAR_AWAY, awake: true })
    case "press":
      return { state: r.hover ? { ...s, height: 0 } : s, intents: [intent(input.target, 1)], operations: [op("Enter", input.target, r.mode === "pen" ? "contact" : "press")] }
    case "secondary":
      return { state: s, intents: [intent(input.target, 1)], operations: [op("Inspect", input.target, r.mode === "pen" ? "barrel-button" : "secondary-press")] }
    case "frame": {
      const dt = s.lastFrame ? Math.min(r.timing.longestFrame, now - s.lastFrame) : r.timing.firstFrame
      let pointer = s.pointer
      if (now - s.lastEvent > r.timing.stillAfter) pointer = rest(pointer, dt, r.feel)
      const factor = r.hover ? hoverFactor(s.height) : 1
      const goals = share(input.targets.map((t) => score(t.box, pointer, r.radius, r.feel)), r.feel)
      let settling = Math.hypot(pointer.vx, pointer.vy) > r.timing.stillSpeed
      const shown: Record<string, number> = {}
      const intents = input.targets.map((t, i) => {
        const goal = goals[i] * factor
        const after = ease(s.shown[t.id] ?? 0, goal, dt, r.feel)
        if (after !== goal) settling = true
        shown[t.id] = after
        return intent(t.id, after)
      })
      return { state: { ...s, pointer, shown, awake: settling, lastFrame: settling ? now : 0 }, intents, operations: [] }
    }
  }
}

export interface PointerOptions {
  radius?: number
  feel?: Partial<Feel>
  timing?: Partial<Widen<typeof POINTER_TIMING>>
}

function readAdapter<I extends PointerInput | PenInput>(mode: "pointer" | "pen", baseFeel: Feel, baseTiming: Widen<typeof POINTER_TIMING>, o: PointerOptions): Adapter<PointerState, I> {
  const r: Reader = { feel: { ...baseFeel, ...o.feel }, timing: { ...baseTiming, ...o.timing }, radius: o.radius ?? 72, hover: mode === "pen", mode }
  return {
    mode,
    constants: { ...r.feel, ...r.timing },
    init: freshPointer,
    step: (s, input, now) => readStep(r, s, input, now),
    release: (s) => ({ state: freshPointer(), intents: Object.keys(s.shown).map((t) => intent(t, 0)), operations: [] }),
  }
}

export const pointerAdapter = (o: PointerOptions = {}): Adapter<PointerState, PointerInput> => readAdapter("pointer", POINTER_FEEL, POINTER_TIMING, o)
export const penAdapter = (o: PointerOptions = {}): Adapter<PointerState, PenInput> => readAdapter("pen", PEN_FEEL, PEN_TIMING, o)

export type TouchInput =
  | { mode: "touch"; type: "down"; target: string }
  | { mode: "touch"; type: "up"; target: string | null }
  | { mode: "touch"; type: "cancel" }
  | { mode: "touch"; type: "tick" }

export interface TouchState {
  down: { target: string; at: number; peeked: boolean } | null
  revealed: { target: string; at: number } | null
  lit: string[]
}

export const TOUCH_CONSTANTS = {
  longPress: 500,
  revealHold: 4000,
} as const

export function touchAdapter(o: { constants?: Partial<Widen<typeof TOUCH_CONSTANTS>> } = {}): Adapter<TouchState, TouchInput> {
  const c = { ...TOUCH_CONSTANTS, ...o.constants }
  const fresh = (): TouchState => ({ down: null, revealed: null, lit: [] })
  const out = (state: TouchState, next: Intent[], operations: Operation[] = []): Step<TouchState> => ({
    state: { ...state, lit: ids(next) }, intents: settle(state.lit, next), operations,
  })
  const holding = (s: TouchState): Intent[] => {
    const lit: Intent[] = []
    if (s.revealed) lit.push(intent(s.revealed.target, 1))
    if (s.down && s.down.target !== s.revealed?.target) lit.push(intent(s.down.target, 1))
    return lit
  }
  return {
    mode: "touch",
    constants: { ...c },
    init: fresh,
    step(s, input, now) {
      const expired = s.revealed && now - s.revealed.at >= c.revealHold
      if (expired) s = { ...s, revealed: null }
      switch (input.type) {
        case "down":
          s = { ...s, down: { target: input.target, at: now, peeked: false } }
          return out(s, holding(s))
        case "tick": {
          if (s.down && !s.down.peeked && now - s.down.at >= c.longPress) {
            s = { ...s, down: { ...s.down, peeked: true } }
            return out(s, holding(s), [op("Inspect", s.down!.target, "long-press")])
          }
          return out(s, holding(s))
        }
        case "cancel":
          return out({ ...s, down: null }, holding({ ...s, down: null }))
        case "up": {
          const d = s.down
          if (!d) return out(s, holding(s))
          s = { ...s, down: null }
          if (input.target !== d.target || d.peeked) return out(s, holding(s))
          if (now - d.at >= c.longPress) return out(s, holding(s), [op("Inspect", d.target, "long-press")])
          if (s.revealed?.target === d.target) {
            s = { ...s, revealed: null }
            return out(s, holding(s), [op("Enter", d.target, "second-tap")])
          }
          s = { ...s, revealed: { target: d.target, at: now } }
          return out(s, holding(s), [op("Inspect", d.target, "first-tap")])
        }
      }
    },
    release: (s) => ({ state: fresh(), intents: s.lit.map((t) => intent(t, 0)), operations: [] }),
  }
}

export type KeyboardInput =
  | { mode: "keyboard"; type: "keydown"; key: string; shift?: boolean; repeat?: boolean }
  | { mode: "keyboard"; type: "focus"; target: string; order: readonly string[] }
  | { mode: "keyboard"; type: "blur" }

export interface KeyboardState {
  focus: string | null
  dir: 1 | -1 | 0
  run: number
  lastNavAt: number | null
  lit: string[]
}

export const KEYBOARD_CONSTANTS = {
  runGap: 600,
} as const

const FORWARD = new Set(["Tab", "ArrowDown", "ArrowRight"])
const BACKWARD = new Set(["ArrowUp", "ArrowLeft"])

export function keyboardAdapter(o: { constants?: Partial<Widen<typeof KEYBOARD_CONSTANTS>> } = {}): Adapter<KeyboardState, KeyboardInput> {
  const c = { ...KEYBOARD_CONSTANTS, ...o.constants }
  const fresh = (): KeyboardState => ({ focus: null, dir: 0, run: 0, lastNavAt: null, lit: [] })
  return {
    mode: "keyboard",
    constants: { ...c },
    init: fresh,
    step(s, input, now) {
      const out = (state: KeyboardState, next: Intent[], operations: Operation[] = []): Step<KeyboardState> => ({
        state: { ...state, lit: ids(next) }, intents: settle(s.lit, next), operations,
      })
      switch (input.type) {
        case "keydown": {
          const dir = FORWARD.has(input.key) ? (input.shift && input.key === "Tab" ? -1 : 1) : BACKWARD.has(input.key) ? -1 : 0
          if (dir !== 0) {
            const continues = s.lastNavAt !== null && s.dir === dir && (input.repeat === true || now - s.lastNavAt <= c.runGap)
            return { state: { ...s, dir, run: continues ? s.run + 1 : 1, lastNavAt: now }, intents: [], operations: [] }
          }
          if (s.focus && input.key === "Enter") return out(s, [intent(s.focus, 1)], [op("Enter", s.focus, "enter-key")])
          if (s.focus && input.key === "ContextMenu") return out(s, [intent(s.focus, 1)], [op("Inspect", s.focus, "context-menu-key")])
          return { state: s, intents: [], operations: [] }
        }
        case "focus": {
          const travelling = s.lastNavAt !== null && now - s.lastNavAt <= c.runGap
          const r = travelling ? s.run : 0
          const next: Intent[] = [intent(input.target, r <= 1 ? 1 : 1 / r)]
          if (r > 1) {
            const ahead = input.order[input.order.indexOf(input.target) + s.dir]
            if (ahead !== undefined) next.push(intent(ahead, 1 - 1 / r))
            else next[0] = intent(input.target, 1)
          }
          return out({ ...s, focus: input.target }, next)
        }
        case "blur":
          return out({ ...s, focus: null, dir: 0, run: 0, lastNavAt: null }, [])
      }
    },
    release: (s) => ({ state: fresh(), intents: s.lit.map((t) => intent(t, 0)), operations: [] }),
  }
}

export interface Label {
  id: string
  label: string
}
export type VoiceInput =
  | { mode: "voice"; type: "partial"; transcript: string; labels: readonly Label[] }
  | { mode: "voice"; type: "final"; transcript: string; labels: readonly Label[] }
  | { mode: "voice"; type: "tick" }

export interface VoiceState {
  at: number | null
  lit: string[]
}

export const VOICE_CONSTANTS = {
  partialStale: 1500,
} as const

const normal = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
const INSPECT_WORDS = ["show ", "peek ", "inspect "]

export function voiceReading(transcript: string, labels: readonly Label[]): Intent[] {
  const t = normal(transcript)
  if (t === "") return []
  const exact = labels.filter((l) => normal(l.label) === t)
  if (exact.length > 0) return exact.map((l) => intent(l.id, 1 / exact.length))
  const hits = labels.filter((l) => normal(l.label).startsWith(t))
  return hits.map((l) => intent(l.id, t.length / normal(l.label).length / hits.length))
}

export function voiceAdapter(o: { constants?: Partial<Widen<typeof VOICE_CONSTANTS>> } = {}): Adapter<VoiceState, VoiceInput> {
  const c = { ...VOICE_CONSTANTS, ...o.constants }
  const fresh = (): VoiceState => ({ at: null, lit: [] })
  return {
    mode: "voice",
    constants: { ...c },
    init: fresh,
    step(s, input, now) {
      const out = (at: number | null, next: Intent[], operations: Operation[] = []): Step<VoiceState> => ({
        state: { at, lit: ids(next) }, intents: settle(s.lit, next), operations,
      })
      switch (input.type) {
        case "partial":
          return out(now, voiceReading(input.transcript, input.labels))
        case "tick":
          return s.at !== null && now - s.at >= c.partialStale ? out(null, []) : { state: s, intents: [], operations: [] }
        case "final": {
          const said = normal(input.transcript)
          const verb = INSPECT_WORDS.find((w) => said.startsWith(w))
          const hit = input.labels.find((l) => normal(l.label) === (verb ? said.slice(verb.length) : said))
          if (!hit) return out(null, [])
          return out(null, [], [op(verb ? "Inspect" : "Enter", hit.id, verb ? "spoken-inspect" : "spoken-label")])
        }
      }
    },
    release: (s) => ({ state: fresh(), intents: s.lit.map((t) => intent(t, 0)), operations: [] }),
  }
}

export type GazeInput =
  | { mode: "gaze"; type: "gaze"; x: number; y: number; targets: readonly Target[] }
  | { mode: "gaze"; type: "tick" }
  | { mode: "gaze"; type: "confirm" }
  | { mode: "gaze"; type: "lost" }

export interface GazeState {
  on: string | null
  since: number
  lastSeen: number
  peeked: boolean
  lit: string[]
}

export const GAZE_CONSTANTS = {
  dwellFull: 800,
  lostGrace: 150,
} as const

export function gazeAdapter(o: { constants?: Partial<Widen<typeof GAZE_CONSTANTS>> } = {}): Adapter<GazeState, GazeInput> {
  const c = { ...GAZE_CONSTANTS, ...o.constants }
  const fresh = (): GazeState => ({ on: null, since: 0, lastSeen: 0, peeked: false, lit: [] })
  return {
    mode: "gaze",
    constants: { ...c },
    init: fresh,
    step(s, input, now) {
      if (input.type === "gaze") {
        const hit = input.targets.find((t) => distanceToBox(t.box, input.x, input.y) === 0)?.id ?? null
        if (hit !== null && hit !== s.on) s = { ...s, on: hit, since: now, lastSeen: now, peeked: false }
        else if (hit !== null) s = { ...s, lastSeen: now }
      } else if (input.type === "lost") {
        s = { ...s, on: null, peeked: false }
      } else if (input.type === "confirm") {
        if (!s.on) return { state: s, intents: [], operations: [] }
        return { state: { ...s, lit: [s.on] }, intents: [intent(s.on, 1)], operations: [op("Enter", s.on, "confirm")] }
      }
      if (s.on !== null && now - s.lastSeen > c.lostGrace) s = { ...s, on: null, peeked: false }
      const operations: Operation[] = []
      const next: Intent[] = []
      if (s.on !== null) {
        const dwell = Math.min(1, (now - s.since) / c.dwellFull)
        next.push(intent(s.on, dwell))
        if (dwell >= 1 && !s.peeked) {
          s = { ...s, peeked: true }
          operations.push(op("Inspect", s.on!, "dwell"))
        }
      }
      return { state: { ...s, lit: ids(next) }, intents: settle(s.lit, next), operations }
    },
    release: (s) => ({ state: fresh(), intents: s.lit.map((t) => intent(t, 0)), operations: [] }),
  }
}

export type SwitchInput =
  | { mode: "switch"; type: "start"; order: readonly string[] }
  | { mode: "switch"; type: "tick" }
  | { mode: "switch"; type: "select" }
  | { mode: "switch"; type: "peek" }
  | { mode: "switch"; type: "stop" }

export interface SwitchState {
  order: string[]
  cursor: number
  steppedAt: number
  active: boolean
  lit: string[]
}

export const SWITCH_CONSTANTS = {
  scanInterval: 1000,
} as const

export function switchAdapter(o: { constants?: Partial<Widen<typeof SWITCH_CONSTANTS>> } = {}): Adapter<SwitchState, SwitchInput> {
  const c = { ...SWITCH_CONSTANTS, ...o.constants }
  const fresh = (): SwitchState => ({ order: [], cursor: 0, steppedAt: 0, active: false, lit: [] })
  const show = (s: SwitchState, now: number, operations: Operation[] = []): Step<SwitchState> => {
    const next: Intent[] = []
    if (s.active && s.order.length > 0) {
      next.push(intent(s.order[s.cursor], 1))
      if (s.order.length > 1) next.push(intent(s.order[(s.cursor + 1) % s.order.length], (now - s.steppedAt) / c.scanInterval))
    }
    return { state: { ...s, lit: ids(next) }, intents: settle(s.lit, next), operations }
  }
  return {
    mode: "switch",
    constants: { ...c },
    init: fresh,
    step(s, input, now) {
      switch (input.type) {
        case "start":
          return show({ ...s, order: [...input.order], cursor: 0, steppedAt: now, active: input.order.length > 0 }, now)
        case "stop":
          return show({ ...s, active: false }, now)
        case "tick": {
          if (!s.active) return { state: s, intents: [], operations: [] }
          const steps = Math.floor((now - s.steppedAt) / c.scanInterval)
          if (steps > 0) s = { ...s, cursor: (s.cursor + steps) % s.order.length, steppedAt: s.steppedAt + steps * c.scanInterval }
          return show(s, now)
        }
        case "select":
        case "peek": {
          if (!s.active) return { state: s, intents: [], operations: [] }
          const target = s.order[s.cursor]
          return show(s, now, [op(input.type === "select" ? "Enter" : "Inspect", target, input.type === "select" ? "switch-select" : "switch-peek")])
        }
      }
    },
    release: (s) => ({ state: fresh(), intents: s.lit.map((t) => intent(t, 0)), operations: [] }),
  }
}

export type Input = PointerInput | PenInput | TouchInput | KeyboardInput | VoiceInput | GazeInput | SwitchInput

export function modeOfPointerType(pointerType: string): Mode {
  return pointerType === "pen" ? "pen" : pointerType === "touch" ? "touch" : "pointer"
}

export interface ModeState {
  mode: Mode | null
  since: number
  changes: number
}
export const initialMode: ModeState = { mode: null, since: 0, changes: 0 }

export function observeMode(s: ModeState, mode: Mode, now: number): { state: ModeState; changed: boolean; from: Mode | null } {
  if (s.mode === mode) return { state: s, changed: false, from: s.mode }
  return { state: { mode, since: now, changes: s.mode === null ? s.changes : s.changes + 1 }, changed: true, from: s.mode }
}

export type Adapters = { [M in Mode]: Adapter<any, any> }

export function defaultAdapters(): Adapters {
  return {
    pointer: pointerAdapter(), pen: penAdapter(), touch: touchAdapter(), keyboard: keyboardAdapter(),
    voice: voiceAdapter(), gaze: gazeAdapter(), switch: switchAdapter(),
  }
}

export interface Session {
  mode: ModeState
  states: Partial<Record<Mode, unknown>>
}
export const newSession = (): Session => ({ mode: initialMode, states: {} })

export interface SessionStep {
  session: Session
  mode: Mode
  changed: boolean
  intents: Intent[]
  operations: Operation[]
}

export function stepSession(adapters: Adapters, session: Session, input: Input, now: number): SessionStep {
  const seen = observeMode(session.mode, input.mode, now)
  let states = session.states
  const intents: Intent[] = []
  if (seen.changed && seen.from !== null && states[seen.from] !== undefined) {
    const leaving = adapters[seen.from].release(states[seen.from])
    intents.push(...leaving.intents)
    states = { ...states, [seen.from]: leaving.state }
  }
  const adapter = adapters[input.mode]
  const stepped = adapter.step(states[input.mode] ?? adapter.init(), input, now)
  intents.push(...stepped.intents)
  return {
    session: { mode: seen.state, states: { ...states, [input.mode]: stepped.state } },
    mode: input.mode,
    changed: seen.changed,
    intents,
    operations: stepped.operations,
  }
}

export const capabilityExists = (id: string): boolean => CAPABILITIES.some((c) => c.id === id)

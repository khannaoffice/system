import { modeOfPointerType, penAdapter, pointerAdapter, POINTER_FEEL, type Intent, type PointerState, type Target } from "../../core/src/intent.ts"
import { project, type Pointer } from "../../core/src/reading.ts"

export interface ApproachOptions {
  selector?: string
  radius?: number
  onFrame?: (frame: { pointer: Pointer; ahead: { x: number; y: number } }) => void
}

export function approach({ selector = "a", radius = 72, onFrame }: ApproachOptions = {}): () => void {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return () => {}

  const adapters = { pointer: pointerAdapter({ radius }), pen: penAdapter({ radius }) }
  const feel = POINTER_FEEL
  type Reading = keyof typeof adapters
  let mode: Reading | "touch" = "pointer"
  let state: PointerState = adapters.pointer.init()
  let frame = 0

  const targets = () => Array.from(document.querySelectorAll<HTMLElement>(selector))
  const ids = new WeakMap<Element, string>()
  let next = 0
  const idOf = (el: Element) => {
    let id = ids.get(el)
    if (id === undefined) ids.set(el, (id = `t${next++}`))
    return id
  }
  let shown = new Map<string, HTMLElement>()
  const write = (intents: Intent[]) => {
    for (const i of intents) shown.get(i.target)?.style.setProperty("--near", i.certainty.toFixed(3))
  }

  function tick(now: number) {
    frame = 0
    if (mode === "touch") return
    const els = targets()
    shown = new Map()
    const frameTargets: Target[] = els.map((el) => {
      const id = idOf(el)
      shown.set(id, el)
      return { id, box: el.getBoundingClientRect() }
    })
    const step = adapters[mode].step(state, { mode, type: "frame", targets: frameTargets } as never, now)
    state = step.state
    write(step.intents)
    onFrame?.({ pointer: state.pointer, ahead: project(state.pointer, feel) })
    if (state.awake) frame = requestAnimationFrame(tick)
  }

  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }

  function become(next: Reading | "touch") {
    if (next === mode) return
    if (mode !== "touch") write(adapters[mode].release(state).intents)
    cancelAnimationFrame(frame)
    frame = 0
    mode = next
    if (next !== "touch") state = adapters[next].init()
  }

  function onMove(e: PointerEvent) {
    const m = modeOfPointerType(e.pointerType)
    become(m === "pen" ? "pen" : m === "touch" ? "touch" : "pointer")
    if (mode === "touch") return
    const input = mode === "pen"
      ? { mode: "pen" as const, type: "move" as const, x: e.clientX, y: e.clientY, height: 0 }
      : { mode: "pointer" as const, type: "move" as const, x: e.clientX, y: e.clientY }
    state = adapters[mode].step(state, input as never, e.timeStamp).state
    wake()
  }

  function onLeave(e: PointerEvent) {
    if (modeOfPointerType(e.pointerType) === "touch" || mode === "touch") return
    state = adapters[mode].step(state, { mode, type: "leave" } as never, e.timeStamp).state
    wake()
  }

  window.addEventListener("pointermove", onMove, { passive: true })
  document.documentElement.addEventListener("pointerleave", onLeave)

  return () => {
    window.removeEventListener("pointermove", onMove)
    document.documentElement.removeEventListener("pointerleave", onLeave)
    cancelAnimationFrame(frame)
    for (const el of targets()) el.style.removeProperty("--near")
  }
}

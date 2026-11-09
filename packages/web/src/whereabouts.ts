export type Move = "forward" | "back" | "zoom-in" | "zoom-out"

export interface Whereabouts {
  position: (path: string) => number
  parent?: (path: string) => string | null
  focus?: (from: string, to: string) => Element | null
  travellers?: (from: string, to: string) => Iterable<Element>
  here?: () => string
  ready?: (path: string) => Promise<void>
}

export const ATTRIBUTE = "data-whereabouts"
export const TRAVELLING = "data-whereabouts-travelling"

const bare = (path: string) => path.split(/[?#]/)[0]

export function moveFor(site: Whereabouts, from: string, to: string): Move | null {
  const a = bare(from)
  const b = bare(to)
  if (site.parent?.(b) === a) return "zoom-in"
  if (site.parent?.(a) === b) return "zoom-out"
  const pa = site.position(a)
  const pb = site.position(b)
  if (pa === pb) return null
  return pb > pa ? "forward" : "back"
}

export function canMove(): boolean {
  return (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

export function hurry(transition: ViewTransition, rate = 5): void {
  const quicken = () => {
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ""
      if (target.startsWith("::view-transition")) animation.playbackRate = rate
    }
  }
  const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const
  for (const input of inputs) window.addEventListener(input, quicken, { capture: true, passive: true })
  transition.finished.catch(() => {}).finally(() => {
    for (const input of inputs) window.removeEventListener(input, quicken, { capture: true })
  })
}

function aim(el: Element | null | undefined) {
  const style = document.documentElement.style
  if (!el) {
    style.removeProperty("--zoom-x")
    style.removeProperty("--zoom-y")
    return
  }
  const r = el.getBoundingClientRect()
  style.setProperty("--zoom-x", `${Math.round(r.left + r.width / 2)}px`)
  style.setProperty("--zoom-y", `${Math.round(r.top + r.height / 2)}px`)
}

function mark(site: Whereabouts, from: string, to: string) {
  for (const el of document.querySelectorAll(`[${TRAVELLING}]`)) el.removeAttribute(TRAVELLING)
  for (const el of site.travellers?.(from, to) ?? []) el.setAttribute(TRAVELLING, "")
}

function unmark() {
  for (const el of document.querySelectorAll(`[${TRAVELLING}]`)) el.removeAttribute(TRAVELLING)
}

export function move(site: Whereabouts, from: string, to: string, update: () => void | Promise<void>): ViewTransition | null {
  const way = moveFor(site, from, to)
  if (!way || !canMove()) {
    void update()
    return null
  }
  const root = document.documentElement
  root.setAttribute(ATTRIBUTE, way)
  aim(way.startsWith("zoom") ? site.focus?.(from, to) : null)
  mark(site, from, to)
  const transition = document.startViewTransition(async () => {
    await update()
    await site.ready?.(bare(to))
    mark(site, from, to)
  })
  void transition.ready.catch(() => {})
  hurry(transition)
  transition.finished.catch(() => {}).finally(() => {
    root.removeAttribute(ATTRIBUTE)
    unmark()
  })
  return transition
}

export function onHistory(site: Whereabouts, current: () => string, update?: () => void | Promise<void>): () => void {
  const handedOn = new WeakSet<Event>()
  const onPop = (e: PopStateEvent) => {
    if (handedOn.has(e)) return
    const to = site.here?.() ?? location.pathname
    const from = current()
    if (e.hasUAVisualTransition || !canMove() || !moveFor(site, from, to)) return
    if (update) {
      move(site, from, to, update)
      return
    }
    e.stopImmediatePropagation()
    move(site, from, to, () => {
      const again = new PopStateEvent("popstate", { state: e.state })
      handedOn.add(again)
      window.dispatchEvent(again)
    })
  }
  window.addEventListener("popstate", onPop, true)
  return () => window.removeEventListener("popstate", onPop, true)
}

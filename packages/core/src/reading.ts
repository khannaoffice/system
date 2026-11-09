export interface Feel {
  lookahead: number
  maxLead: number
  fullSpeed: number
  velocityTau: number
  restTau: number
  riseTau: number
  fallTau: number
  share: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Pointer {
  x: number
  y: number
  vx: number
  vy: number
}

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

export function distanceToBox(box: Box, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right)
  const dy = Math.max(box.top - y, 0, y - box.bottom)
  return Math.hypot(dx, dy)
}

export function project(p: Pointer, feel: Feel): { x: number; y: number } {
  let lx = p.vx * feel.lookahead
  let ly = p.vy * feel.lookahead
  const lead = Math.hypot(lx, ly)
  if (lead > feel.maxLead) {
    lx *= feel.maxLead / lead
    ly *= feel.maxLead / lead
  }
  return { x: p.x + lx, y: p.y + ly }
}

export function score(box: Box, p: Pointer, radius: number, feel: Feel): number {
  const here = smoothstep(1 - distanceToBox(box, p.x, p.y) / radius)
  const speed = Math.hypot(p.vx, p.vy)
  const commit = Math.min(1, speed / feel.fullSpeed)
  if (commit < 0.01) return here

  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  const reach = Math.hypot(cx - p.x, cy - p.y) || 1
  const toward = Math.max(0, ((cx - p.x) * p.vx + (cy - p.y) * p.vy) / (reach * speed))
  const ahead = project(p, feel)
  const there = smoothstep(1 - distanceToBox(box, ahead.x, ahead.y) / radius)
  return Math.max(here, there * toward * commit)
}

export function share(scores: readonly number[], feel: Feel): number[] {
  const weights = scores.map((s) => s ** feel.share)
  const total = weights.reduce((a, b) => a + b, 0)
  return scores.map((s, i) => (total > 0 ? s * (weights[i] / total) : 0))
}

export function ease(shown: number, goal: number, dt: number, feel: Feel): number {
  const tau = goal > shown ? feel.riseTau : feel.fallTau
  const next = shown + (goal - shown) * (1 - Math.exp(-dt / tau))
  return Math.abs(goal - next) < 0.001 ? goal : next
}

export function follow(p: Pointer, x: number, y: number, dt: number, feel: Feel): Pointer {
  const k = 1 - Math.exp(-dt / feel.velocityTau)
  return { x, y, vx: p.vx + ((x - p.x) / dt - p.vx) * k, vy: p.vy + ((y - p.y) / dt - p.vy) * k }
}

export function rest(p: Pointer, dt: number, feel: Feel): Pointer {
  const k = Math.exp(-dt / feel.restTau)
  return { ...p, vx: p.vx * k, vy: p.vy * k }
}

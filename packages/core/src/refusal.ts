export const B_MODULE = Object.freeze({ w: 84, h: 80, gapX: 12, gapY: 10, columns: 12 })

export interface Lattice {
  readonly columns: number
  readonly scale: number
  readonly module: { readonly w: number; readonly h: number }
  readonly gap: { readonly x: number; readonly y: number }
  readonly pitch: { readonly x: number; readonly y: number }
}

export function lattice(options: { columns?: number; scale?: number } = {}): Lattice {
  const columns = options.columns ?? B_MODULE.columns
  const scale = options.scale ?? 1
  if (!(Number.isSafeInteger(columns) && columns >= 1)) throw new RangeError("columns must be a whole number from 1")
  if (!(Number.isFinite(scale) && scale > 0)) throw new RangeError("scale must be a positive number")
  const w = B_MODULE.w * scale
  const h = B_MODULE.h * scale
  const gx = B_MODULE.gapX * scale
  const gy = B_MODULE.gapY * scale
  return Object.freeze({ columns, scale, module: Object.freeze({ w, h }), gap: Object.freeze({ x: gx, y: gy }), pitch: Object.freeze({ x: w + gx, y: h + gy }) })
}

declare const onLattice: unique symbol

export interface Placement {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly [onLattice]: true
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

export type Rule = "whole-modules" | "span" | "origin" | "pair" | "columns" | "overlap"

export interface Refusal {
  ok: false
  rule: Rule
  message: string
}

export interface Placed {
  ok: true
  placement: Placement
  rect: Rect
}

export type Outcome = Placed | Refusal

export interface Request {
  x?: unknown
  y?: unknown
  w?: unknown
  h?: unknown
}

const refuse = (rule: Rule, message: string): Refusal => ({ ok: false, rule, message })
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n)
const make = (x: number, y: number, w: number, h: number): Placement => Object.freeze({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, w, h }) as Placement

export function rectOf(lat: Lattice, p: Placement): Rect {
  const left = p.x * lat.pitch.x
  const top = p.y * lat.pitch.y
  const width = p.w * lat.module.w + (p.w - 1) * lat.gap.x
  const height = p.h * lat.module.h + (p.h - 1) * lat.gap.y
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const placed = (lat: Lattice, p: Placement): Placed => ({ ok: true, placement: p, rect: rectOf(lat, p) })
const overlaps = (a: Placement, b: Placement) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function admit(lat: Lattice, x: unknown, y: unknown, w: unknown, h: unknown, others: readonly Placement[]): Outcome {
  if (!whole(w) || !whole(h) || (x !== undefined && !whole(x)) || (y !== undefined && !whole(y))) return refuse("whole-modules", "A placement is a whole number of modules; there is no half a module on this system.")
  if (w < 1 || h < 1) return refuse("span", "A placement spans at least one module across and one down.")
  if ((x === undefined) !== (y === undefined)) return refuse("pair", "A placement needs both its column and its row, or neither, and the next free place is found for it.")
  if (w > lat.columns) return refuse("columns", `This spans ${w} columns and the system has ${lat.columns}.`)
  if (x === undefined || y === undefined) {
    const rows = [...new Set([0, ...others.map((o) => o.y + o.h)])].sort((a, b) => a - b)
    const cols = [...new Set([0, ...others.map((o) => o.x + o.w)])].sort((a, b) => a - b).filter((c) => c + w <= lat.columns)
    for (const row of rows) {
      if (!Number.isSafeInteger(row + h)) continue
      for (const col of cols) {
        const candidate = make(col, row, w, h)
        if (!others.some((o) => overlaps(candidate, o))) return placed(lat, candidate)
      }
    }
    return refuse("whole-modules", "There is no room left to place this.")
  }
  if (x < 0 || y < 0) return refuse("origin", "A placement cannot start before the first column or the first row.")
  if (!Number.isSafeInteger(y + h)) return refuse("whole-modules", "That row is further down than the system can count.")
  if (x + w > lat.columns) return refuse("columns", `This would run to column ${x + w} and the system has ${lat.columns}.`)
  const candidate = make(x, y, w, h)
  if (others.some((o) => overlaps(candidate, o))) return refuse("overlap", "Something is already there; two things cannot share a module.")
  return placed(lat, candidate)
}

export function place(lat: Lattice, request: Request, others: readonly Placement[] = []): Outcome {
  return admit(lat, request.x, request.y, request.w === undefined ? 1 : request.w, request.h === undefined ? 1 : request.h, others)
}

export function nudge(lat: Lattice, p: Placement, dx: unknown, dy: unknown, others: readonly Placement[] = []): Outcome {
  if (!whole(dx) || !whole(dy)) return refuse("whole-modules", "A placement moves by a whole number of modules.")
  return admit(lat, p.x + dx, p.y + dy, p.w, p.h, others)
}

export function resize(lat: Lattice, p: Placement, dw: unknown, dh: unknown, others: readonly Placement[] = []): Outcome {
  if (!whole(dw) || !whole(dh)) return refuse("whole-modules", "A placement changes by a whole number of modules.")
  return admit(lat, p.x, p.y, p.w + dw, p.h + dh, others)
}

export function snap(lat: Lattice, rect: { left: number; top: number; width: number; height: number }, others: readonly Placement[] = []): Outcome {
  const values = [rect.left, rect.top, rect.width, rect.height]
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return refuse("whole-modules", "That rectangle has no size or place to snap from.")
  const x = Math.round(rect.left / lat.pitch.x)
  const y = Math.round(rect.top / lat.pitch.y)
  const w = Math.max(1, Math.round((rect.width + lat.gap.x) / lat.pitch.x))
  const h = Math.max(1, Math.round((rect.height + lat.gap.y) / lat.pitch.y))
  return admit(lat, x, y, w, h, others)
}

export function isOnLattice(lat: Lattice, value: unknown): value is Placement {
  if (!value || typeof value !== "object") return false
  const { x, y, w, h } = value as Record<string, unknown>
  return whole(x) && whole(y) && whole(w) && whole(h) && x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= lat.columns && Number.isSafeInteger(y + h)
}

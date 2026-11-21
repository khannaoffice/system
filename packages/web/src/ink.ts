// Ink: the left edge of type, and the stem of a glyph, from the face itself.
//
// ink.css places type by its capitals and baseline. What CSS cannot do is the
// left edge: an H starts 7.5px inside its box at 96px Helvetica Neue, a T
// 0.2px, an opening quote a whole glyph's width. This module reads each face's
// ink with the canvas (any loaded font, no font files, no parser) and sets
// every line of a heading on its ink edge, without touching the document:
//
//   - the whole block moves by `translate`, which reflows nothing
//   - the first line by `text-indent`
//   - each later line by a zero-width ::before float whose `shape-outside`
//     gives that line its own inset
//
// No node is added or split, so React, hydration and editing are safe.
// Measurements are cached per face and letter: a page pays a few canvas calls
// per face, once.

export const EDGE = "data-ink-edge"
export const SET = "data-ink-edge-set"
export const GLYPH = "data-ink-glyph"
export const DEFAULT_SELECTOR = "[data-ink] :is(h1, h2, h3, h4, h5, h6, blockquote), [data-ink-edge]"

/** Opening marks that hang outside the edge, so the letter after them aligns. */
export const HANG = new Set([..."\"'“‘„‚«‹「『（([{¿¡"])

export interface Measure {
  /** Ink left of the pen for `text` in `font`, in px (positive: ink left of the pen). */
  left(font: string, text: string): number
  /** Advance width of `text` in `font`, in px. */
  width(font: string, text: string): number
}

/**
 * How far the ink of `text`'s first letter stands inside the pen, in px. A
 * positive number pulls the line left; for an opening mark it is the mark's
 * whole advance (with its kerning) plus the next letter's own inset, so the
 * mark hangs and the letter aligns.
 */
export function inset(m: Measure, font: string, text: string): number {
  const [first, next] = [...text]
  if (first === undefined) return 0
  if (HANG.has(first) && next !== undefined && !HANG.has(next) && next.trim()) {
    return m.width(font, first + next) - m.width(font, next) + inset(m, font, next)
  }
  return -m.left(font, first)
}

export interface Line {
  /** Top and bottom of the line, from the element's content-box top, in px. */
  top: number
  bottom: number
  /** The inset of the line's first letter, in px (see `inset`). */
  inset: number
}

export interface Placement {
  /** How far the whole block moves left (translate), in px. */
  shift: number
  /** The first line's own text-indent, in px. */
  indent: number
  /** The float that sets later lines, or null when they all move alike. */
  float: { reach: number; polygon: string; height: number } | null
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`

/**
 * Where to put a block so that every line's first ink lands on the edge.
 * The block moves left by `shift`; a later line k is pushed back right by
 * `shift - inset_k` by the float; the first line's indent is `shift - inset_0`.
 * `origin` is where the float's top stands, from the content-box top: engines
 * disagree (Blink: the content edge; WebKit: the first line box's top).
 */
export function place(lines: Line[], precision = 0.25, origin = 0): Placement {
  if (!lines.length) return { shift: 0, indent: 0, float: null }
  const later = lines.slice(1)
  if (later.every((l) => Math.abs(l.inset - lines[0].inset) < precision)) return { shift: lines[0].inset, indent: 0, float: null }
  const shift = Math.max(...later.map((l) => l.inset))
  // A float's shape is read across a whole line box, so each band must run
  // between line-box boundaries, not glyph extents (which overlap). Leading is
  // split evenly above and below the glyphs, so the boundary between two lines
  // is the midpoint of their centres.
  const centre = (l: Line) => (l.top + l.bottom) / 2
  const boundary = (k: number) => (centre(lines[k - 1]) + centre(lines[k])) / 2
  // Lines touch, and engines centre glyphs in their line boxes a little
  // differently, so a step placed exactly on a boundary is at the mercy of
  // rounding. Instead each step sits a quarter of the line pitch inside the
  // narrower band. A line then only overlaps a neighbour's band where that
  // band is narrower than its own, and a line takes the widest band it
  // overlaps, so each line gets exactly its own width.
  const height = lines[lines.length - 1].bottom
  const widths = lines.map((l, k) => (k === 0 ? 0 : shift - l.inset))
  const points: string[] = [`0 0`]
  for (let k = 1; k < lines.length; k++) {
    const slack = (centre(lines[k]) - centre(lines[k - 1])) / 4
    const y = boundary(k) + (widths[k] > widths[k - 1] ? slack : -slack)
    points.push(`${px(widths[k - 1])} ${px(y - origin)}`, `${px(widths[k])} ${px(y - origin)}`)
  }
  points.push(`${px(widths[lines.length - 1])} ${px(height - origin)}`, `0 ${px(height - origin)}`)
  // An overhanging letter (an A, a W) is pushed right past the shift, so the
  // float is as wide as its widest band, not as the shift.
  return { shift, indent: shift - lines[0].inset, float: { reach: Math.max(...widths), polygon: `polygon(${points.join(", ")})`, height: height - origin } }
}

/** A face's vertical stem, as a fraction of its size, from the coverage of one row through an "l". */
export function stemOf(rows: Uint8ClampedArray, width: number, height: number, size: number): number {
  const y = Math.floor(height / 2)
  let covered = 0
  for (let x = 0; x < width; x++) covered += rows[(y * width + x) * 4 + 3] / 255
  return covered / size
}

/* ---------------------------------------------------------------- page */

const fontOf = (style: CSSStyleDeclaration) =>
  `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`

type CanvasMeasure = Measure & { stem(font: string): number }
let shared: CanvasMeasure | null = null
function canvasMeasure(): CanvasMeasure {
  if (shared) return shared
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  const lefts = new Map<string, number>()
  const widths = new Map<string, number>()
  const stems = new Map<string, number>()
  const at = (font: string) => {
    if (ctx.font !== font) ctx.font = font
  }
  const SIZE = 200
  const EDGE_SIZE = 200
  shared = {
    left(font, text) {
      // Read from pixels, not from measureText's actualBoundingBoxLeft: WebKit
      // reports 0 and Gecko is a pixel out. One small render per face and
      // letter, at 200px, of only the region round the pen, refined by the
      // coverage of the first inked column (about a hundredth of a pixel).
      const face = font.replace(/\s[\d.]+px\s/, ` ${EDGE_SIZE}px `)
      const size = parseFloat(font.match(/\s([\d.]+)px\s/)?.[1] ?? `${EDGE_SIZE}`)
      const key = face + "\u0000" + text
      if (!lefts.has(key)) {
        const scan = (reach: number) => {
          const x0 = EDGE_SIZE / 2
          const W = Math.ceil(x0 + reach * EDGE_SIZE)
          const H = Math.ceil(EDGE_SIZE * 1.6)
          if (canvas.width !== W || canvas.height !== H) {
            canvas.width = W
            canvas.height = H
          } else ctx.clearRect(0, 0, W, H)
          ctx.font = face
          ctx.textBaseline = "alphabetic"
          ctx.fillText(text, x0, EDGE_SIZE * 1.15)
          const d = ctx.getImageData(0, 0, W, H).data
          for (let x = 0; x < W; x++) {
            let alpha = 0
            for (let y = 0; y < H; y++) alpha = Math.max(alpha, d[(y * W + x) * 4 + 3])
            if (alpha > 0) return (x0 - (x + 1 - alpha / 255)) / EDGE_SIZE
          }
          return NaN
        }
        // Most letters ink within 0.7em of the pen; a rare wide bearing looks further.
        let found = scan(0.7)
        if (isNaN(found)) found = scan(2)
        lefts.set(key, isNaN(found) ? 0 : found)
      }
      return lefts.get(key)! * size
    },
    width(font, text) {
      const key = font + "\u0000" + text
      if (!widths.has(key)) {
        at(font)
        widths.set(key, ctx.measureText(text).width)
      }
      return widths.get(key)!
    },
    stem(font) {
      const face = font.replace(/\s[\d.]+px\s/, ` ${SIZE}px `)
      if (!stems.has(face)) {
        canvas.width = SIZE * 2
        canvas.height = SIZE * 2
        ctx.font = face
        ctx.textBaseline = "middle"
        ctx.fillText("l", SIZE / 2, SIZE)
        stems.set(face, stemOf(ctx.getImageData(0, 0, SIZE * 2, SIZE * 2).data, SIZE * 2, SIZE * 2, SIZE))
      }
      return stems.get(face)!
    },
  }
  return shared
}

/**
 * Every line of `el`, with the text that starts it. Each text run reports its
 * line boxes at once (getClientRects), and the first letter of each later line
 * is found by binary search, so a long heading costs a few measurements per
 * line rather than one per letter.
 */
function linesOf(el: Element): { top: number; bottom: number; left: number; font: string; text: string }[] {
  const origin = el.getBoundingClientRect()
  const padTop = (parseFloat(getComputedStyle(el).paddingTop) || 0) + (parseFloat(getComputedStyle(el).borderTopWidth) || 0)
  const out: { top: number; bottom: number; left: number; font: string; text: string }[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  const charRect = (node: Text, i: number) => {
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    return range.getBoundingClientRect()
  }
  let lastTop = -Infinity
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data
    const first = text.search(/\S/)
    if (first < 0) continue
    range.selectNodeContents(node)
    const boxes = [...range.getClientRects()].filter((r) => r.height > 0)
    if (!boxes.length) continue
    const font = fontOf(getComputedStyle(node.parentElement!))
    // The top of each line this run reaches, in order.
    const tops: number[] = []
    for (const b of boxes) if (!tops.length || b.top > tops[tops.length - 1] + b.height / 2) tops.push(b.top)
    let from = first
    tops.forEach((top, k) => {
      // The first non-space letter whose box stands on this line.
      let lo = from
      let hi = text.length - 1
      if (k > 0) {
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (charRect(node!, mid).top >= top - 1) hi = mid
          else lo = mid + 1
        }
      }
      while (lo < text.length && !text[lo].trim()) lo++
      if (lo >= text.length) return
      const r = charRect(node!, lo)
      from = lo
      const t = r.top - origin.top - padTop
      const b = r.bottom - origin.top - padTop
      if (r.top > lastTop + r.height / 2) {
        out.push({ top: t, bottom: b, left: r.left, font, text: text.slice(lo, lo + 2) })
        lastTop = r.top
      } else {
        out[out.length - 1].bottom = Math.max(out[out.length - 1].bottom, b)
      }
    })
    // The run's last line may reach lower than its first letter.
    const lastBox = boxes[boxes.length - 1]
    if (out.length) out[out.length - 1].bottom = Math.max(out[out.length - 1].bottom, lastBox.bottom - origin.top - padTop)
  }
  return out
}

const STYLE_ID = "ink-edge-style"
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
:where([${SET}]) { translate: calc(-1 * var(--ink-shift, 0px)) 0; text-indent: var(--ink-indent, 0px); }
:where([${SET}="lines"])::before {
  content: ""; float: inline-start; inline-size: var(--ink-reach); block-size: var(--ink-height);
  shape-outside: var(--ink-shape);
}`
  document.head.append(style)
}

const PROPS = ["--ink-shift", "--ink-indent", "--ink-reach", "--ink-shape", "--ink-height", "--ink-stem"]
const original = new WeakMap<Element, string | null>()
function remember(el: HTMLElement) {
  if (!original.has(el)) original.set(el, el.getAttribute("style"))
}
function clear(el: HTMLElement) {
  el.removeAttribute(SET)
  el.removeAttribute("data-ink-stem")
  for (const p of PROPS) el.style.removeProperty(p)
  if (!original.has(el)) return
  // Put the style attribute back exactly as it was, unless the page has changed it since.
  const was = original.get(el)!
  const probe = document.createElement("i")
  if (was !== null) probe.setAttribute("style", was)
  // Compare declarations, not text: engines re-serialise a touched style.
  const same = probe.style.length === el.style.length && [...probe.style].every((p) => probe.style.getPropertyValue(p) === el.style.getPropertyValue(p))
  if (same) {
    if (was === null) el.removeAttribute("style")
    else el.setAttribute("style", was)
  }
  original.delete(el)
}

interface Job {
  el: HTMLElement
  free: boolean
  target: number
  lineBoxTop: number
  height: number
  lines: Line[]
  origins: number[]
  origin: number
  rebreaks: number
}

const firstLineOnly = (lines: Line[]): Placement => ({ shift: 0, indent: -lines[0].inset, float: null })

/**
 * Set many elements on their ink edge in one batch. Every write is done, then
 * every read, so a page is laid out a few times per batch, not once or more
 * per element.
 */
export function edges(els: HTMLElement[], m: Measure = canvasMeasure()): Map<HTMLElement, Line[]> {
  const result = new Map<HTMLElement, Line[]>()
  if (!els.length) return result
  ensureStyle()
  // Write: start from the box as the page drew it.
  for (const el of els) clear(el)
  // Read: everything each element needs.
  let jobs: Job[] = []
  for (const el of els) {
    const style = getComputedStyle(el)
    if (style.direction !== "ltr" || !/^(start|left|justify)$/.test(style.textAlign)) continue
    const lines = linesOf(el).map((l) => ({ top: l.top, bottom: l.bottom, inset: inset(m, l.font, l.text) }))
    if (!lines.length) continue
    const box = el.getBoundingClientRect()
    const lh = parseFloat(style.lineHeight)
    const first = lines[0]
    const lineBoxTop = (first.top + first.bottom) / 2 - (isNaN(lh) ? first.bottom - first.top : lh) / 2
    // A site's own ::before keeps the element to its first-line edge.
    const free = el.getAttribute(EDGE) !== "first" && getComputedStyle(el, "::before").content === "none"
    const height = el.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
    const target = box.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0)
    // Where a float's top stands differs by engine: the content edge, or the first line box's top.
    jobs.push({ el, free, target, lineBoxTop, height, lines, origins: [0, lineBoxTop], origin: 0, rebreaks: 0 })
    result.set(el, lines)
  }
  for (const job of jobs) remember(job.el)
  // Up to four rounds of write-then-read; most elements settle in the first.
  for (let round = 0; round < 4 && jobs.length; round++) {
    for (const job of jobs) {
      const at = job.free ? place(job.lines, 0.25, job.origin) : firstLineOnly(job.lines)
      apply(job.el, at, job.origin, job.height)
    }
    const next: Job[] = []
    for (const job of jobs) {
      if (job.el.getAttribute(SET) !== "lines") continue
      const landed = linesOf(job.el)
      const same = landed.length === job.lines.length
      if (same && landed.every((l, i) => Math.abs(l.left + job.lines[i].inset - job.target) < 1)) continue
      if (!same && job.rebreaks < 1) {
        // The new edges moved a line break: read the lines again and place them once more.
        job.rebreaks++
        job.lines = landed.map((l) => ({ top: l.top, bottom: l.bottom, inset: inset(m, l.font, l.text) }))
        result.set(job.el, job.lines)
        next.push(job)
        continue
      }
      const tried = job.origins.indexOf(job.origin)
      if (tried + 1 < job.origins.length) {
        job.origin = job.origins[tried + 1]
        next.push(job)
      } else {
        // An engine that sets the float some other way keeps the first-line edge only.
        job.free = false
        next.push(job)
      }
    }
    jobs = next
  }
  return result
}

/** Set one element on its ink edge. */
export function edge(el: HTMLElement, m: Measure = canvasMeasure()): Line[] {
  return edges([el], m).get(el) ?? []
}

function apply(el: HTMLElement, at: Placement, origin: number, height: number) {
  el.style.setProperty("--ink-shift", px(at.shift))
  el.style.setProperty("--ink-indent", px(at.indent))
  if (at.float) {
    el.style.setProperty("--ink-reach", px(at.float.reach))
    el.style.setProperty("--ink-shape", at.float.polygon)
    // Never below the element's own lines: a float that hung out would push the next block's text.
    el.style.setProperty("--ink-height", px(Math.min(at.float.height, height - origin)))
    el.setAttribute(SET, "lines")
  } else {
    for (const p of ["--ink-reach", "--ink-shape", "--ink-height"]) el.style.removeProperty(p)
    el.setAttribute(SET, "")
  }
}

/** Give a glyph the stem of the face it sits in, as `--ink-stem` in em. */
export function stem(el: Element, m = canvasMeasure()): number {
  const s = m.stem(fontOf(getComputedStyle(el)))
  remember(el as HTMLElement)
  const value = `${Math.round(s * 10000) / 10000}em`
  if ((el as HTMLElement).style.getPropertyValue("--ink-stem") !== value) (el as HTMLElement).style.setProperty("--ink-stem", value)
  if (!el.hasAttribute("data-ink-stem")) el.setAttribute("data-ink-stem", "")
  return s
}

/* ------------------------------------------------------------- frames */

const BLOCK = /^(block|flow-root|list-item|table-cell|table-caption|inline-block)$/
const ATOM = /^(inline-block|inline-flex|inline-grid|inline-table)$/
const REPLACED_SELECTOR = "img, svg, video, canvas, iframe, input, button, select, textarea, object, embed"
const REPLACED = new Set(REPLACED_SELECTOR.toUpperCase().split(", "))
const INLINE = /^(inline|contents)$/
const SPACE = /\S/

/** What a pass needs to know of an element's style, each fact read once and only when asked. */
interface Facts {
  display: string
  style: CSSStyleDeclaration
  flow?: boolean
  top?: number
  bottom?: number
}
type Styles = (el: Element) => Facts
const styleCache = (): Styles => {
  const cache = new Map<Element, Facts>()
  return (el) => {
    let f = cache.get(el)
    if (!f) {
      const style = getComputedStyle(el)
      cache.set(el, (f = { display: style.display, style }))
    }
    return f
  }
}
/** Out of the flow of lines: hidden, positioned out, or floated. */
const outOf = (f: Facts) => {
  if (f.flow === undefined) {
    const p = f.style.position
    f.flow = !(f.display === "none" || p === "absolute" || p === "fixed" || f.style.float !== "none")
  }
  return !f.flow
}
const frameOf = (f: Facts, side: "top" | "bottom") => {
  if (f[side] === undefined) {
    const s = f.style
    f[side] = (parseFloat(s.getPropertyValue(`padding-${side}`)) || 0) + (parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0)
  }
  return f[side]!
}

const isAtom = (el: Element, st: Styles) => {
  if (el.hasAttribute(GLYPH) && el.getAttribute(GLYPH) !== "free") return false
  const f = st(el)
  if (f.display === "none" || (outOf(f) && f.style.float === "none")) return false
  return REPLACED.has(el.tagName.toUpperCase()) || ATOM.test(f.display)
}

/** The element whose own lines are `el`'s first (or last) line: descend while that line belongs to a child block. */
function lineHolder(el: Element, end: "first" | "last", st: Styles): Element {
  const step = (n: ChildNode) => (end === "first" ? n.nextSibling : n.previousSibling)
  for (let n: ChildNode | null = end === "first" ? el.firstChild : el.lastChild; n; n = step(n!)) {
    if (n.nodeType === 3) {
      if (SPACE.test((n as Text).data)) return el
      continue
    }
    if (n.nodeType !== 1) continue
    const f = st(n as Element)
    if (outOf(f)) continue
    if (INLINE.test(f.display) || isAtom(n as Element, st)) return el
    return lineHolder(n as Element, end, st)
  }
  return el
}

/**
 * Whether the line at this end of `el` holds a box rather than only text: an
 * image, a control, an inline-block, anywhere on that line. Trimming it at the
 * capitals or the baseline would cut the box, so that edge keeps its leading.
 */
function atomAt(el: Element, end: "first" | "last", st: Styles): boolean {
  const holder = lineHolder(el, end, st)
  // Plain text, the common case, holds no box at all.
  if (!holder.firstElementChild) return false
  const atoms: Element[] = []
  for (const child of holder.querySelectorAll("*")) if (isAtom(child, st)) atoms.push(child)
  if (!atoms.length) return false
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
  let text: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!SPACE.test(n.data)) continue
    text = n
    if (end === "first") break
  }
  if (!text) return true
  const at = end === "first" ? text.data.search(SPACE) : text.data.trimEnd().length - 1
  const range = document.createRange()
  range.setStart(text, at)
  range.setEnd(text, at + 1)
  const line = range.getBoundingClientRect()
  return atoms.some((a) => {
    const r = a.getBoundingClientRect()
    return r.bottom > line.top && r.top < line.bottom
  })
}

/** Whether `child` is the first (or last) thing in its parent's flow: nothing but space or out-of-flow boxes before (after) it. */
function atEdgeOf(child: Element, end: "first" | "last", st: Styles): boolean {
  const step = (n: ChildNode) => (end === "first" ? n.previousSibling : n.nextSibling)
  for (let n: ChildNode | null = step(child); n; n = step(n!)) {
    if (n.nodeType === 3) {
      if (SPACE.test((n as Text).data)) return false
      continue
    }
    if (n.nodeType !== 1) continue
    if (!outOf(st(n as Element))) return false
  }
  return true
}

/**
 * Mark every edge where text meets a frame, from the real layout. The walk
 * starts from the text, not the elements: from each block holding text it
 * climbs while that text is first (or last) in its parent, until it meets
 * padding or a border. A block container there trims that side (the trim
 * reaches its first or last line); an item of a flex or grid container whose
 * edge is framed trims the side it stands on, so text side by side trims
 * together whatever holds it. Elements with no text at an edge are never
 * visited, and a climb stops where an earlier one already went. Returns the
 * number of elements marked.
 */
export function frames(root: ParentNode = document): number {
  const walk = framer(root)
  walk.step(Infinity)
  walk.finish()
  return walk.count()
}

/**
 * The same walk, resumable: `step` goes on through the text in document order
 * until a time budget is spent or the text lies `below` a point on screen, and
 * writes what it found; `finish` clears marks the walk did not find again.
 * ink() runs the walk to a screen past the viewport at once, and the rest in
 * idle slices, so a long page is never set in one long task.
 */
export function framer(root: ParentNode = document) {
  const st = styleCache()
  const marks = new Map<HTMLElement, Set<"start" | "end">>()
  const fresh = new Set<HTMLElement>()
  const mark = (el: Element, side: "start" | "end") => {
    const h = el as HTMLElement
    if (!marks.has(h)) marks.set(h, new Set())
    marks.get(h)!.add(side)
    fresh.add(h)
  }
  const scope = root === document ? document.body : (root as Node)
  const off = [...(root as ParentNode).querySelectorAll('[data-ink="off"]')]
  const inScope = (el: Element) => !!el.closest("[data-ink]") && !off.some((o) => o.contains(el))
  const holders = new Set<Element>()
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  const seen = { first: new Set<Element>(), last: new Set<Element>() }
  const climb = (start: Element, end: "first" | "last") => {
    const side = end === "first" ? "start" : "end"
    const edgeSide = end === "first" ? "top" : "bottom"
    let cur: Element = start
    for (;;) {
      if (seen[end].has(cur)) return
      seen[end].add(cur)
      const f = st(cur)
      if (f.display === "none") return
      if (frameOf(f, edgeSide) > 0) {
        if (BLOCK.test(f.display) && !atomAt(cur, end, st)) mark(cur, side)
        return
      }
      const parent = cur.parentElement
      if (!parent || parent === document.documentElement) return
      const pf = st(parent)
      if (pf.display.includes("flex") || pf.display.includes("grid")) {
        if (frameOf(pf, edgeSide) > 0 && BLOCK.test(f.display)) {
          const box = parent.getBoundingClientRect()
          const r = cur.getBoundingClientRect()
          const stands = end === "first"
            ? Math.abs(r.top - (parseFloat(f.style.marginTop) || 0) - (box.top + frameOf(pf, "top"))) < 1
            : Math.abs(r.bottom + (parseFloat(f.style.marginBottom) || 0) - (box.bottom - frameOf(pf, "bottom"))) < 1
          if (stands && !atomAt(cur, end, st)) mark(cur, side)
        }
        return
      }
      if (!atEdgeOf(cur, end, st)) return
      cur = parent
    }
  }
  const flush = () => {
    for (const el of fresh) {
      const sides = marks.get(el)!
      const value = sides.size === 2 ? "both" : [...sides][0]
      if (el.getAttribute("data-ink-trim") !== value) el.setAttribute("data-ink-trim", value)
    }
    fresh.clear()
  }
  let complete = false
  return {
    /** Walk on; true once every text on the page has been read. */
    step(budget: number, below = Infinity): boolean {
      if (complete) return true
      const t0 = performance.now()
      let k = 0
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (!SPACE.test(n.data)) continue
        let el = n.parentElement
        while (el && INLINE.test(st(el).display)) el = el.parentElement
        if (!el || holders.has(el)) continue
        holders.add(el)
        if (inScope(el)) {
          climb(el, "first")
          climb(el, "last")
        }
        if ((++k & 15) === 0 && (performance.now() - t0 > budget || (below < Infinity && el.getBoundingClientRect().top > below))) {
          flush()
          return false
        }
      }
      flush()
      complete = true
      return true
    },
    /** Clear the marks this walk did not find again. */
    finish() {
      for (const el of (root as ParentNode).querySelectorAll<HTMLElement>("[data-ink-trim]")) if (!marks.has(el)) el.removeAttribute("data-ink-trim")
    },
    count: () => marks.size,
  }
}

export interface InkOptions {
  selector?: string
  root?: ParentNode
  /** How far beyond the screen a heading is set ahead of time, as a CSS margin. Default: one screen. */
  ahead?: string
}

/**
 * Set every heading on its ink edge and every glyph on its face's stem, and
 * keep them there as fonts load, widths change and content changes. Headings
 * on or near the screen are set at once; the rest as they come within a
 * screen of it. Returns a function that stops and puts everything back.
 */
export function ink(options: InkOptions = {}): () => void {
  const selector = options.selector ?? DEFAULT_SELECTOR
  const root = options.root ?? document
  const m = canvasMeasure()
  const dirty = new Set<HTMLElement>()
  const near = new Set<Element>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) near.add(e.target)
        else near.delete(e.target)
      }
      const ready = [...dirty].filter((el) => near.has(el))
      for (const el of ready) dirty.delete(el)
      edges(ready, m)
    },
    { rootMargin: options.ahead ?? "100% 0px 100% 0px" },
  )
  const widths = new WeakMap<Element, number>()
  const resize = new ResizeObserver((entries) => {
    // Only a change of width moves line breaks; the first report is the width we already set for.
    let moved = false
    for (const e of entries) {
      const w = e.contentRect.width
      if (widths.has(e.target) && widths.get(e.target) !== w) moved = true
      widths.set(e.target, w)
    }
    if (moved) soon()
  })
  const run = () => {
    // WebKit re-resolves `from-font` on every element instead of inheriting the
    // number, so state the number where data-ink-size is set.
    root.querySelectorAll<HTMLElement>("[data-ink-size]").forEach((el) => {
      remember(el)
      el.style.removeProperty("font-size-adjust")
      const metric = el.getAttribute("data-ink-size") === "cap" ? "cap-height" : "ex-height"
      const value = parseFloat(getComputedStyle(el).fontSizeAdjust.replace(/^[a-z-]+\s+/, ""))
      if (!isNaN(value)) el.style.setProperty("font-size-adjust", `${metric} ${value}`)
      el.setAttribute("data-ink-sized", "")
    })
    // Frames: to a screen past the viewport now, the rest in idle slices.
    cancelIdle()
    walk = framer(root)
    if (walk.step(Infinity, window.innerHeight * 2)) {
      walk.finish()
      walk = null
    } else idle = later(goOn)
    const heads = [...root.querySelectorAll<HTMLElement>(selector)]
    const vh = window.innerHeight
    const now: HTMLElement[] = []
    for (const h of heads) {
      io.observe(h)
      resize.observe(h)
      const r = h.getBoundingClientRect()
      if (r.bottom > -vh && r.top < 2 * vh) now.push(h)
      else dirty.add(h)
    }
    edges(now, m)
    root.querySelectorAll(`[${GLYPH}]`).forEach((el) => stem(el, m))
  }
  let walk: ReturnType<typeof framer> | null = null
  let idle = 0
  const hasIdle = typeof requestIdleCallback === "function"
  const later = (fn: () => void) => (hasIdle ? requestIdleCallback(fn, { timeout: 200 }) : (setTimeout(fn, 16) as unknown as number))
  const cancelIdle = () => (hasIdle ? cancelIdleCallback(idle) : clearTimeout(idle))
  const SLICE = 4
  const goOn = () => {
    if (!walk) return
    if (walk.step(SLICE)) {
      walk.finish()
      walk = null
    } else idle = later(goOn)
  }
  let frame = 0
  const soon = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(run)
  }
  run()
  document.fonts?.addEventListener("loadingdone", soon)
  // Pages that change (client navigation, new content) are read again. Ink's own
  // writes are attributes, which this does not watch, so it cannot loop.
  const changes = new MutationObserver(soon)
  changes.observe(root === document ? document.body : (root as Node), { childList: true, subtree: true, characterData: true })
  return () => {
    cancelAnimationFrame(frame)
    cancelIdle()
    walk = null
    io.disconnect()
    resize.disconnect()
    changes.disconnect()
    document.fonts?.removeEventListener("loadingdone", soon)
    root.querySelectorAll<HTMLElement>("[data-ink-trim]").forEach((el) => el.removeAttribute("data-ink-trim"))
    root.querySelectorAll<HTMLElement>(`${selector}, [data-ink-stem], [data-ink-sized]`).forEach((el) => {
      if (el.hasAttribute("data-ink-sized")) {
        el.style.removeProperty("font-size-adjust")
        el.removeAttribute("data-ink-sized")
      }
      clear(el)
    })
  }
}

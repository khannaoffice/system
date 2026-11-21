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
  shared = {
    left(font, text) {
      // Read from pixels, not from measureText's actualBoundingBoxLeft: WebKit
      // reports 0 and Gecko is a pixel out. One render per face and letter, at
      // 200px, refined by the coverage of the first inked column.
      const face = font.replace(/\s[\d.]+px\s/, ` ${SIZE}px `)
      const size = parseFloat(font.match(/\s([\d.]+)px\s/)?.[1] ?? `${SIZE}`)
      const key = face + "\u0000" + text
      if (!lefts.has(key)) {
        const W = SIZE * 3
        const H = SIZE * 2
        const x0 = SIZE
        canvas.width = W
        canvas.height = H
        ctx.font = face
        ctx.textBaseline = "alphabetic"
        ctx.fillText(text, x0, SIZE * 1.4)
        const d = ctx.getImageData(0, 0, W, H).data
        let edge = NaN
        for (let x = 0; x < W && isNaN(edge); x++) {
          let alpha = 0
          for (let y = 0; y < H; y++) alpha = Math.max(alpha, d[(y * W + x) * 4 + 3])
          if (alpha > 0) edge = x + 1 - alpha / 255
        }
        lefts.set(key, isNaN(edge) ? 0 : (x0 - edge) / SIZE)
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

/** Every line of `el`, with the text that starts it, by walking its text. */
function linesOf(el: Element): { top: number; bottom: number; left: number; font: string; text: string }[] {
  const origin = el.getBoundingClientRect()
  const padTop = parseFloat(getComputedStyle(el).paddingTop) || 0
  const out: { top: number; bottom: number; left: number; font: string; text: string }[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let lastTop = -Infinity
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data
    for (let i = 0; i < text.length; i++) {
      if (!text[i].trim()) continue
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect()
      if (!r.height) continue
      const top = r.top - origin.top - padTop
      const bottom = r.bottom - origin.top - padTop
      if (r.top > lastTop + r.height / 2) {
        out.push({ top, bottom, left: r.left, font: fontOf(getComputedStyle(node.parentElement!)), text: text.slice(i, i + 2) })
        lastTop = r.top
      } else {
        out[out.length - 1].bottom = Math.max(out[out.length - 1].bottom, bottom)
      }
    }
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

/** Set one element on its ink edge. Exported for tests and for one-off use. */
export function edge(el: HTMLElement, m: Measure = canvasMeasure()): Line[] {
  ensureStyle()
  clear(el)
  const style = getComputedStyle(el)
  if (style.direction !== "ltr" || !/^(start|left|justify)$/.test(style.textAlign)) return []
  // A site's own ::before keeps the element to moving as a whole.
  const free = el.getAttribute(EDGE) !== "first" && getComputedStyle(el, "::before").content === "none"
  remember(el)
  const box = el.getBoundingClientRect()
  const target = box.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0)
  const lineHeight = parseFloat(style.lineHeight)
  let lines: Line[] = []
  // A later line's edge can change where the lines break; settle in at most three passes.
  for (let pass = 0; pass < 3; pass++) {
    const found = linesOf(el).map((l) => ({ top: l.top, bottom: l.bottom, inset: inset(m, l.font, l.text) }))
    const settled = pass > 0 && found.length === lines.length && found.every((l, i) => Math.abs(l.inset - lines[i].inset) < 0.25)
    lines = found
    if (!lines.length || settled) break
    if (!free) {
      apply(el, { shift: 0, indent: -lines[0].inset, float: null })
      break
    }
    // Where the float's top stands differs by engine: try the content edge, then the first line box's top.
    const first = lines[0]
    const lineBoxTop = (first.top + first.bottom) / 2 - (isNaN(lineHeight) ? first.bottom - first.top : lineHeight) / 2
    let placed = false
    for (const origin of [0, lineBoxTop]) {
      const at = place(lines, 0.25, origin)
      apply(el, at, origin)
      if (!at.float) { placed = true; break }
      const landed = linesOf(el)
      // Within a pixel: WebKit and Gecko set glyphs on whole pixels.
      if (landed.length === lines.length && landed.every((l, i) => Math.abs(l.left + lines[i].inset - target) < 1)) { placed = true; break }
    }
    // An engine that sets the float some other way keeps the first-line edge only.
    if (!placed) apply(el, { shift: 0, indent: -lines[0].inset, float: null })
    if (!placed || !el.hasAttribute(SET) || el.getAttribute(SET) !== "lines") break
  }
  return lines
}

function apply(el: HTMLElement, at: Placement, origin = 0) {
  el.style.setProperty("--ink-shift", px(at.shift))
  el.style.setProperty("--ink-indent", px(at.indent))
  if (at.float) {
    el.style.setProperty("--ink-reach", px(at.float.reach))
    el.style.setProperty("--ink-shape", at.float.polygon)
    // Never below the element's own lines: a float that hung out would push the next block's text.
    el.style.setProperty("--ink-height", px(Math.min(at.float.height, contentHeight(el) - origin)))
    el.setAttribute(SET, "lines")
  } else {
    for (const p of ["--ink-reach", "--ink-shape", "--ink-height"]) el.style.removeProperty(p)
    el.setAttribute(SET, "")
  }
}

function contentHeight(el: HTMLElement) {
  const st = getComputedStyle(el)
  return el.clientHeight - (parseFloat(st.paddingTop) || 0) - (parseFloat(st.paddingBottom) || 0)
}

/** Give a glyph the stem of the face it sits in, as `--ink-stem` in em. */
export function stem(el: Element, m = canvasMeasure()): number {
  const s = m.stem(fontOf(getComputedStyle(el)))
  remember(el as HTMLElement)
  ;(el as HTMLElement).style.setProperty("--ink-stem", `${Math.round(s * 10000) / 10000}em`)
  el.setAttribute("data-ink-stem", "")
  return s
}

/* ------------------------------------------------------------- frames */

const BLOCK = /^(block|flow-root|list-item|table-cell|table-caption|inline-block)$/
const edgeOf = (s: CSSStyleDeclaration, side: "top" | "bottom") =>
  (parseFloat(s.getPropertyValue(`padding-${side}`)) || 0) + (parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0)

const ATOM = /^(inline-block|inline-flex|inline-grid|inline-table)$/
const REPLACED = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "OBJECT", "EMBED"])

const isAtom = (el: Element) => {
  if (el.hasAttribute(GLYPH) && el.getAttribute(GLYPH) !== "free") return false
  const s = getComputedStyle(el)
  if (s.display === "none" || s.position === "absolute" || s.position === "fixed") return false
  return REPLACED.has(el.tagName.toUpperCase()) || ATOM.test(s.display)
}
const INLINE = /^(inline|contents)$/

/** The element whose own lines are `el`'s first (or last) line: descend while that line belongs to a child block. */
function lineHolder(el: Element, end: "first" | "last"): Element {
  const nodes = [...el.childNodes]
  if (end === "last") nodes.reverse()
  for (const node of nodes) {
    if (node.nodeType === 3) {
      if ((node as Text).data.trim()) return el
      continue
    }
    if (node.nodeType !== 1) continue
    const s = getComputedStyle(node as Element)
    if (s.display === "none" || s.position === "absolute" || s.position === "fixed" || s.float !== "none") continue
    if (INLINE.test(s.display) || isAtom(node as Element)) return el
    return lineHolder(node as Element, end)
  }
  return el
}

/**
 * Whether the line at this end of `el` holds a box rather than only text: an
 * image, a control, an inline-block, anywhere on that line. Trimming it at the
 * capitals or the baseline would cut the box, so that edge keeps its leading.
 */
function atomAt(el: Element, end: "first" | "last"): boolean {
  const holder = lineHolder(el, end)
  const atoms = [...holder.querySelectorAll("*")].filter(isAtom)
  if (!atoms.length) return false
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
  let text: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.data.trim()) continue
    text = n
    if (end === "first") break
  }
  if (!text) return true
  const at = end === "first" ? text.data.search(/\S/) : text.data.trimEnd().length - 1
  const range = document.createRange()
  range.setStart(text, at)
  range.setEnd(text, at + 1)
  const line = range.getBoundingClientRect()
  return atoms.some((a) => {
    const r = a.getBoundingClientRect()
    return r.bottom > line.top && r.top < line.bottom
  })
}

/**
 * Mark every edge where text meets a frame, from the real layout: a block
 * container with padding or a border on a side trims that side (the trim
 * reaches its first or last line); a flex or grid container with one passes it
 * to each item standing on that edge, so text side by side trims together.
 * Returns the number of elements marked.
 */
export function frames(root: ParentNode = document): number {
  const want = new Map<HTMLElement, Set<"start" | "end">>()
  const mark = (el: HTMLElement, side: "start" | "end") => {
    if (!want.has(el)) want.set(el, new Set())
    want.get(el)!.add(side)
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-ink], [data-ink] *")) {
    const s = getComputedStyle(el)
    if (s.display === "none" || s.display === "contents" || (s.display.startsWith("inline") && s.display !== "inline-block")) continue
    const top = edgeOf(s, "top") > 0
    const bottom = edgeOf(s, "bottom") > 0
    if (!top && !bottom) continue
    if (BLOCK.test(s.display)) {
      if (top && !atomAt(el, "first")) mark(el, "start")
      if (bottom && !atomAt(el, "last")) mark(el, "end")
    } else if (/flex|grid/.test(s.display)) {
      const box = el.getBoundingClientRect()
      const innerTop = box.top + edgeOf(s, "top")
      const innerBottom = box.bottom - edgeOf(s, "bottom")
      for (const child of el.children) {
        const c = child as HTMLElement
        const cs = getComputedStyle(c)
        if (!BLOCK.test(cs.display)) continue
        const r = c.getBoundingClientRect()
        if (top && Math.abs(r.top - (parseFloat(cs.marginTop) || 0) - innerTop) < 1 && !atomAt(c, "first")) mark(c, "start")
        if (bottom && Math.abs(r.bottom + (parseFloat(cs.marginBottom) || 0) - innerBottom) < 1 && !atomAt(c, "last")) mark(c, "end")
      }
    }
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-ink-trim]")) if (!want.has(el)) el.removeAttribute("data-ink-trim")
  for (const [el, sides] of want) {
    const value = sides.size === 2 ? "both" : [...sides][0]
    if (el.getAttribute("data-ink-trim") !== value) el.setAttribute("data-ink-trim", value)
  }
  return want.size
}

export interface InkOptions {
  selector?: string
  root?: ParentNode
}

/**
 * Set every heading on its ink edge and every glyph on its face's stem, and
 * keep them there as fonts load and widths change. Returns a function that
 * stops and puts everything back.
 */
export function ink(options: InkOptions = {}): () => void {
  const selector = options.selector ?? DEFAULT_SELECTOR
  const root = options.root ?? document
  const m = canvasMeasure()
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
    frames(root)
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => edge(el, m))
    root.querySelectorAll(`[${GLYPH}]`).forEach((el) => stem(el, m))
  }
  let frame = 0
  const soon = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(run)
  }
  run()
  document.fonts?.addEventListener("loadingdone", soon)
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
  root.querySelectorAll(selector).forEach((el) => resize.observe(el))
  // Pages that change (client navigation, new content) are read again; our own
  // writes are attributes, which this does not watch, so it cannot loop.
  const changes = new MutationObserver(() => {
    root.querySelectorAll(selector).forEach((el) => resize.observe(el))
    soon()
  })
  changes.observe(root === document ? document.body : (root as Node), { childList: true, subtree: true, characterData: true })
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    changes.disconnect()
    root.querySelectorAll<HTMLElement>("[data-ink-trim]").forEach((el) => el.removeAttribute("data-ink-trim"))
    document.fonts?.removeEventListener("loadingdone", soon)
    root.querySelectorAll<HTMLElement>(`${selector}, [data-ink-stem], [data-ink-sized]`).forEach((el) => {
      if (el.hasAttribute("data-ink-sized")) {
        el.style.removeProperty("font-size-adjust")
        el.removeAttribute("data-ink-sized")
      }
      clear(el)
    })
  }
}

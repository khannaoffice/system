import { test } from "node:test"
import assert from "node:assert/strict"
import { HANG, inset, place, stemOf, type Line, type Measure } from "../src/ink.ts"

// A face where each letter's ink starts at a known distance inside the pen.
const LEFT: Record<string, number> = { H: -7.4, T: -0.1, A: 0.6, O: -3.5, "“": -2 }
const WIDTH: Record<string, number> = { "“": 30, H: 70, "“H": 99 }
const face: Measure = {
  left: (_font, text) => LEFT[text] ?? 0,
  width: (_font, text) => WIDTH[text] ?? 50,
}

test("a letter's inset is how far its ink stands inside the pen", () => {
  assert.equal(inset(face, "f", "Hello"), 7.4)
  assert.equal(inset(face, "f", "Tower"), 0.1)
  assert.equal(inset(face, "f", "Avenue"), -0.6, "an overhanging letter has a negative inset")
})

test("an opening mark hangs: its kerned advance plus the next letter's own inset", () => {
  // “H advances 99, H alone 70: the mark takes 29 with kerning, then H's 7.4
  assert.equal(inset(face, "f", "“H"), 29 + 7.4)
  assert.ok(HANG.has("«") && HANG.has("(") && !HANG.has("H"))
})

test("a mark with nothing after it is a letter like any other", () => {
  assert.equal(inset(face, "f", "“"), 2)
  assert.equal(inset(face, "f", ""), 0)
})

const line = (k: number, inset: number, pitch = 100, glyph = 110): Line => ({ top: k * pitch - 5, bottom: k * pitch - 5 + glyph, inset })

test("lines that start alike move as one block, with no float", () => {
  const at = place([line(0, 7.4), line(1, 7.3), line(2, 7.5)])
  assert.equal(at.float, null)
  assert.equal(at.shift, 7.4)
  assert.equal(at.indent, 0)
})

test("lines that start differently each land on the edge", () => {
  const lines = [line(0, 7.4), line(1, 0.1), line(2, 44.4), line(3, -0.6)]
  const at = place(lines)
  assert.ok(at.float)
  assert.equal(at.shift, 44.4, "the block moves by the largest later inset")
  assert.ok(Math.abs(at.indent - (44.4 - 7.4)) < 1e-9, "the first line's indent brings it back to its own inset")
  // each later line's band is shift - inset, so line k lands at edge - inset_k
  const widths = [...at.float!.polygon.matchAll(/([\d.]+)px ([\d.]+)px/g)].map((m) => Number(m[1]))
  for (const w of [44.3, 0, 45]) assert.ok(widths.some((x) => Math.abs(x - w) < 0.01), `a band of ${w}px`)
  assert.equal(at.float!.reach, 45, "the float is as wide as its widest band, so an overhang is not clipped")
})

test("each step sits a quarter pitch inside the narrower band", () => {
  const at = place([line(0, 0), line(1, 10), line(2, 0)])
  // centres at 50, 150, 250 → boundaries 100 and 200, pitch 100, slack 25.
  // Bands: line 0 is 0 wide (it never floats), line 1 is 10 - 10 = 0, line 2 is 10 - 0 = 10.
  const ys = [...at.float!.polygon.matchAll(/[\d.]+px ([\d.]+)px/g)].map((m) => Number(m[1]))
  assert.ok(ys.includes(75), "between equal bands the step may sit either side; it sits before the boundary")
  assert.ok(ys.includes(225), "the step up to line 2's wider band sits inside line 2, which still takes its own width")
  assert.ok(!ys.includes(200), "never on the boundary itself, where rounding decides")
})

test("the shape follows the float's own top", () => {
  const a = place([line(0, 0), line(1, 10), line(2, 0)], 0.25, 0)
  const b = place([line(0, 0), line(1, 10), line(2, 0)], 0.25, -20)
  const first = (p: string) => Number(p.match(/[\d.]+px ([\d.]+)px/)![1])
  assert.equal(first(b.float!.polygon) - first(a.float!.polygon), 20)
  assert.equal(b.float!.height - a.float!.height, 20)
})

test("no lines, no move", () => {
  assert.deepEqual(place([]), { shift: 0, indent: 0, float: null })
})

test("a stem is the coverage of one row, as a fraction of the size", () => {
  const W = 10, H = 3
  const rows = new Uint8ClampedArray(W * H * 4)
  const y = 1
  // two solid pixels and one half-covered: 2.5px of stem at size 25
  for (const [x, a] of [[3, 255], [4, 255], [5, 127.5]] as const) rows[(y * W + x) * 4 + 3] = a
  assert.ok(Math.abs(stemOf(rows, W, H, 25) - 2.5 / 25) < 0.001)
})

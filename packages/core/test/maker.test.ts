import { test } from "node:test"
import assert from "node:assert/strict"
import { checkDraft, type Draft } from "../src/maker.ts"
import { lattice, place, type Placement } from "../src/refusal.ts"
import { fixture } from "./helpers.ts"

const GOOD: Draft = {
  id: "ko-abcdefghij",
  title: "A new piece",
  summary: "One line.",
  date: "2026-11-05",
  visibility: "public",
  label: { medium: "Poster. Offset on paper, 2026.", paragraphs: ["It says one thing."] },
  placement: { x: 0, y: 0, w: 4, h: 3 },
  media: { width: 1920, height: 1080 },
}

const said = (d: Draft, ctx = {}) => checkDraft(d, ctx).problems.map((p) => `${p.requirement} ${p.field}: ${p.said}`)

test("A1-34.3 a valid draft passes every check that bears on it, and each names its section 24 requirement", () => {
  const report = checkDraft(GOOD, { register: fixture() })
  assert.equal(report.ok, true, JSON.stringify(report.problems))
  assert.deepEqual(report.problems, [])
  const requirements = new Set(report.checks.map((c) => c.requirement))
  for (const id of ["C-24.1-1", "C-24.2-1", "C-24.2-5", "C-24.6-1", "C-24.6-3", "C-24.6-7", "C-24.7-5"]) assert.ok(requirements.has(id), id)
  assert.equal(checkDraft({}).checks.length, 0, "an empty draft has nothing to be wrong yet")
})

test("A1-34.3 an off-lattice placement reads 'this is not on the system: the placement is off the lattice'", () => {
  const out = said({ placement: { x: 1.5, y: 0, w: 2, h: 2 } })
  assert.equal(out.length, 1)
  assert.match(out[0], /^C-24\.6-1 placement: This is not on the system: the placement is off the lattice\./)
  assert.match(out[0], /whole number of modules/)
  assert.match(said({ placement: { x: 11, y: 0, w: 3, h: 1 } })[0], /off the lattice.*system has 12/)
  assert.match(said({ placement: { x: 0, y: 0, w: 0, h: 1 } })[0], /off the lattice/)
  assert.equal(checkDraft({ placement: { x: 2, y: 2, w: 1, h: 1 } }, { lattice: lattice({ scale: 100 / 84 }) }).ok, true)
  assert.equal(checkDraft({ placement: { x: 2, y: 2, w: 1, h: 1 } }, { lattice: lattice({ columns: 2 }) }).ok, false)
})

test("A1-34.3 a place that is taken is told apart from a place that is off the lattice", () => {
  const first = place(lattice(), { x: 0, y: 0, w: 4, h: 3 })
  assert.ok(first.ok)
  const taken: Placement[] = [first.placement]
  const out = said({ placement: { x: 2, y: 1, w: 2, h: 2 } }, { placed: taken })
  assert.equal(out.length, 1)
  assert.match(out[0], /^C-24\.6-1 placement: This is not on the system: the placement is on the lattice but takes a place that is taken\./)
  assert.equal(checkDraft({ placement: { w: 2 } }, { placed: taken }).ok, true, "no x and y: the next free place is found")
})

test("A1-34.3 an id that changed, an id already in the register, and an id the system would not mint", () => {
  const register = fixture()
  const existing = register.objects[0]
  assert.match(said({ id: existing.id }, { register })[0], /^C-24\.2-5 id: This is not on the system: this id already belongs to another object/)
  assert.deepEqual(said({ id: existing.id, title: "Retitled" }, { register, previous: existing }), [], "a new revision of the same object is fine")
  assert.match(said({ id: "ko-zzzzzzzzzz" }, { register, previous: existing })[0], /^C-24\.1-1 id: This is not on the system: the id has changed from /)
  assert.match(said({ id: "My Title" })[0], /^C-24\.1-1 id: This is not on the system: the id is not one the system mints/)
  const gone = { ...register, withdrawn: { "ko-withdrawn1": { withdrawnAt: "2026-01-01" } } }
  assert.match(said({ id: "ko-withdrawn1" }, { register: gone })[0], /already belongs/)
})

test("A1-34.3 title, date, visibility, media and label each say what is wrong, in words", () => {
  assert.match(said({ title: "" })[0], /^C-24\.2-1 title: This is not on the system: the title must have at least 1 characters/)
  assert.match(said({ title: "x".repeat(301) })[0], /the title must have at most 300/)
  assert.match(said({ date: "5 November 2026" })[0], /^C-24\.2-1 date: This is not on the system: the date is not a day written year-month-day/)
  assert.equal(said({ date: "2026-02-30" }).length, 1, "a day that does not exist")
  assert.match(said({ visibility: "secret" })[0], /^C-24\.7-5 visibility: This is not on the system: its visibility is "secret"/)
  assert.match(said({ media: { width: 1920 } })[0], /^C-24\.6-3 media: This is not on the system: the piece has no width and height/)
  assert.match(said({ media: { width: 0, height: 10 } })[0], /C-24\.6-3/)
  assert.match(said({ label: { medium: "Oil." } })[0], /^C-24\.6-7 label: This is not on the system: the label is not of the fixed structure\. After the medium line/)
  assert.match(said({ label: "just a string" })[0], /C-24\.6-7/)
  assert.equal(said({ summary: "x".repeat(1001) }).length, 1)
})

test("A1-34.3 several mistakes are all reported at once, and every message begins the same way", () => {
  const bad: Draft = { id: "no", title: "", date: "yesterday", visibility: "x", placement: { x: -1, y: 0 }, media: {}, label: {} }
  const report = checkDraft(bad)
  assert.equal(report.ok, false)
  assert.equal(report.problems.length, 7)
  for (const p of report.problems) assert.ok(p.said.startsWith("This is not on the system: "), p.said)
  assert.equal(new Set(report.problems.map((p) => p.field)).size, 7, "one problem for each part of the draft")
  for (const c of checkDraft(GOOD).checks) assert.ok(!c.said.startsWith("This is not on the system"))
})

test("A1-34.3 the check runs the core's own rules: a placement refused by the lattice is a problem here, and vice versa", () => {
  const lat = lattice()
  for (let x = -2; x < 15; x++) for (const w of [0, 1, 3, 12, 13]) {
    const request = { x, y: 0, w, h: 1 }
    assert.equal(checkDraft({ placement: request }, { lattice: lat }).ok, place(lat, request).ok, JSON.stringify(request))
  }
})

import { CAPABILITIES, validate, type Schema } from "./capabilities.ts"
import type { Register, SystemObject } from "./core.ts"
import { validateLabel } from "./label.ts"
import { lattice, place, type Lattice, type Placement } from "./refusal.ts"

export interface Draft {
  id?: string
  title?: string
  date?: string
  summary?: string
  visibility?: string
  label?: unknown
  placement?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  media?: { width?: unknown; height?: unknown }
}

export interface Context {
  register?: Register
  previous?: SystemObject
  lattice?: Lattice
  placed?: readonly Placement[]
}

export interface Check {
  requirement: string
  ok: boolean
  said: string
  field: "id" | "title" | "summary" | "date" | "visibility" | "placement" | "media" | "label"
}

export interface Report {
  ok: boolean
  checks: Check[]
  problems: Check[]
}

const ID = /^ko-[a-z0-9]{10,}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const VISIBILITY = ["public", "unlisted", "private"]
const NOT = "This is not on the system:"

const changeSchema = (CAPABILITIES.find((c) => c.id === "ko_preview_change")!.inputSchema.properties!.changes as Schema).properties!

const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function checkDraft(draft: Draft, context: Context = {}): Report {
  const checks: Check[] = []
  const add = (requirement: string, field: Check["field"], ok: boolean, good: string, bad: string) => checks.push({ requirement, field, ok, said: ok ? good : `${NOT} ${bad}` })

  if (draft.id !== undefined) {
    add("C-24.1-1", "id", typeof draft.id === "string" && ID.test(draft.id), "The id is one the system would keep.", "the id is not one the system mints (ko- and ten or more letters and digits), so it could not stay the same as the title changes.")
    if (context.previous) add("C-24.1-1", "id", draft.id === context.previous.id, "The id is kept from the last revision.", `the id has changed from ${context.previous.id}. An object keeps its id when its title does.`)
    if (context.register && !context.previous) {
      const taken = context.register.objects.some((o) => o.id === draft.id) || draft.id in context.register.withdrawn
      add("C-24.2-5", "id", !taken, "The id is new to the register.", "this id already belongs to another object in the register, and two objects cannot share one.")
    }
  }
  if (draft.title !== undefined) {
    const problems = validate(changeSchema.title, draft.title, "the title")
    add("C-24.2-1", "title", problems.length === 0, "The title can be listed.", `${problems[0]}, so it cannot be listed in order.`)
  }
  if (draft.summary !== undefined) {
    const problems = validate(changeSchema.summary, draft.summary, "the summary")
    add("C-24.2-1", "summary", problems.length === 0, "The summary is short enough to list.", `${problems[0]}.`)
  }
  if (draft.date !== undefined) {
    add("C-24.2-1", "date", typeof draft.date === "string" && DATE.test(draft.date) && realDate(draft.date), "The date places it in the order.", "the date is not a day written year-month-day, so it has no place in the order.")
  }
  if (draft.visibility !== undefined) {
    add("C-24.7-5", "visibility", VISIBILITY.includes(draft.visibility), "Its visibility is one the system keeps apart.", `its visibility is "${draft.visibility}", and only public, unlisted or private keep private work out of public lists.`)
  }
  if (draft.placement !== undefined) {
    const out = place(context.lattice ?? lattice(), draft.placement, context.placed ?? [])
    const off = !out.ok && out.rule !== "overlap"
    add("C-24.6-1", "placement", out.ok, "The placement is on the lattice.", out.ok ? "" : off ? `the placement is off the lattice. ${out.message}` : `the placement is on the lattice but takes a place that is taken. ${out.message}`)
  }
  if (draft.media !== undefined) {
    const ok = [draft.media.width, draft.media.height].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    add("C-24.6-3", "media", ok, "The piece has a size, so the page holds its place while it loads.", "the piece has no width and height, so the page would jump when it loads.")
  }
  if (draft.label !== undefined) {
    const issues = validateLabel(draft.label)
    add("C-24.6-7", "label", issues.length === 0, "The label has a medium line and paragraphs, so print and export keep it whole.", `the label is not of the fixed structure. ${issues[0]?.message ?? ""} Print and export would lose it.`)
  }
  const problems = checks.filter((c) => !c.ok)
  return { ok: problems.length === 0, checks, problems }
}

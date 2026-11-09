import type { Relation, SystemObject } from "./core.ts"
import { CONTEXT, toJsonLd } from "./jsonld.ts"

export interface Label {
  medium: string
  paragraphs: string[]
}

export type LabelRule = "not-a-label" | "unknown-field" | "medium-missing" | "medium-not-one-line" | "paragraphs-missing" | "paragraph-empty" | "paragraph-not-text" | "paragraph-has-blank-line" | "untrimmed"

export interface LabelIssue {
  rule: LabelRule
  at: string
  message: string
}

const issue = (rule: LabelRule, at: string, message: string): LabelIssue => ({ rule, at, message })

export function validateLabel(input: unknown): LabelIssue[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [issue("not-a-label", "label", "A label is a medium line followed by paragraphs.")]
  const record = input as Record<string, unknown>
  const out: LabelIssue[] = []
  for (const key of Object.keys(record)) {
    if (key !== "medium" && key !== "paragraphs") out.push(issue("unknown-field", key, `A label has a medium line and paragraphs, and nothing else; "${key}" has no place on it.`))
  }
  const { medium, paragraphs } = record
  if (typeof medium !== "string" || medium.trim() === "") out.push(issue("medium-missing", "medium", "The label starts with a medium line, and this has none."))
  else {
    if (/[\r\n]/.test(medium)) out.push(issue("medium-not-one-line", "medium", "The medium is one line; what follows it belongs in a paragraph."))
    if (medium !== medium.trim()) out.push(issue("untrimmed", "medium", "The medium has spaces at its start or end."))
  }
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) out.push(issue("paragraphs-missing", "paragraphs", "After the medium line the label has paragraphs, and this has none."))
  else {
    paragraphs.forEach((p, i) => {
      const at = `paragraphs[${i}]`
      if (typeof p !== "string") out.push(issue("paragraph-not-text", at, `Paragraph ${i + 1} is not text.`))
      else if (p.trim() === "") out.push(issue("paragraph-empty", at, `Paragraph ${i + 1} is empty.`))
      else {
        if (/\n\s*\n/.test(p)) out.push(issue("paragraph-has-blank-line", at, `Paragraph ${i + 1} holds two paragraphs; give each its own.`))
        if (p !== p.trim()) out.push(issue("untrimmed", at, `Paragraph ${i + 1} has spaces at its start or end.`))
      }
    })
  }
  return out
}

export const isLabel = (input: unknown): input is Label => validateLabel(input).length === 0

export function labelFrom(entry: { medium?: string; body?: string[] }): Label | undefined {
  if (entry.medium === undefined && entry.body === undefined) return undefined
  return { medium: entry.medium as string, paragraphs: (entry.body ?? []) as string[] }
}

export interface PageLabel {
  type: "label"
  children: ({ role: "medium"; text: string } | { role: "paragraph"; text: string })[]
}

export interface Rendered {
  page: PageLabel
  record: Record<string, unknown>
  print: string
}

export function renderLabel(label: Label, object?: SystemObject, options: { relations?: Relation[]; base?: string } = {}): Rendered {
  const issues = validateLabel(label)
  if (issues.length) throw new TypeError(`not a label: ${issues[0].message}`)
  const page: PageLabel = { type: "label", children: [{ role: "medium", text: label.medium }, ...label.paragraphs.map((text) => ({ role: "paragraph" as const, text }))] }
  const words = { "ko:medium": label.medium, "ko:paragraphs": { "@list": [...label.paragraphs] } }
  const record = object ? { ...toJsonLd(object, options.relations ?? [], options.base ?? ""), ...words } : { "@context": CONTEXT, ...words }
  const print = `${object ? `${object.title}\n` : ""}${label.medium}\n\n${label.paragraphs.join("\n\n")}\n`
  return { page, record, print }
}

export const wordsOfPage = (page: PageLabel): Label => ({
  medium: page.children.filter((c) => c.role === "medium").map((c) => c.text).join(""),
  paragraphs: page.children.filter((c) => c.role === "paragraph").map((c) => c.text),
})

export const wordsOfRecord = (record: Record<string, unknown>): Label => ({
  medium: record["ko:medium"] as string,
  paragraphs: [...((record["ko:paragraphs"] as { "@list": string[] })["@list"])],
})

export function wordsOfPrint(print: string, titled: boolean): Label {
  const lines = print.replace(/\n$/, "").split("\n\n")
  const first = lines[0].split("\n")
  return { medium: titled ? first.slice(1).join("\n") : first.join("\n"), paragraphs: lines.slice(1) }
}

export interface LabelAudit {
  ok: string[]
  missing: string[]
  invalid: { id: string; issues: LabelIssue[] }[]
}

export function auditLabels<T extends { id: string }>(items: readonly T[], labelOf: (item: T) => unknown): LabelAudit {
  const audit: LabelAudit = { ok: [], missing: [], invalid: [] }
  for (const item of items) {
    const label = labelOf(item)
    if (label === undefined) audit.missing.push(item.id)
    else {
      const issues = validateLabel(label)
      if (issues.length) audit.invalid.push({ id: item.id, issues })
      else audit.ok.push(item.id)
    }
  }
  return audit
}

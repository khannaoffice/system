import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join } from "node:path"
import { homedir } from "node:os"
import { auditLabels, isLabel, labelFrom, renderLabel, validateLabel, wordsOfPage, wordsOfPrint, wordsOfRecord, type Label } from "../src/label.ts"
import { fixture } from "./helpers.ts"

const LABEL: Label = {
  medium: "Interaction system. TypeScript and CSS, 2026.",
  paragraphs: [
    "Point, choose, reverse, fold. Pointing at a kind shows what choosing it would leave.",
    "Every view is in the address, kind and order, so it can be sent, reloaded, or reached from the back button.",
  ],
}

const rules = (input: unknown) => validateLabel(input).map((i) => i.rule)

test("A1-34.2 a label is a medium line, then paragraphs, and nothing else", () => {
  assert.deepEqual(validateLabel(LABEL), [])
  assert.ok(isLabel(LABEL))
  assert.deepEqual(rules(null), ["not-a-label"])
  assert.deepEqual(rules([]), ["not-a-label"])
  assert.deepEqual(rules({ paragraphs: ["x"] }), ["medium-missing"])
  assert.deepEqual(rules({ medium: "  ", paragraphs: ["x"] }), ["medium-missing"])
  assert.deepEqual(rules({ medium: 4, paragraphs: ["x"] }), ["medium-missing"])
  assert.deepEqual(rules({ medium: "Two\nlines.", paragraphs: ["x"] }), ["medium-not-one-line"])
  assert.deepEqual(rules({ medium: "Oil." }), ["paragraphs-missing"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: [] }), ["paragraphs-missing"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: "text" }), ["paragraphs-missing"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: ["a", ""] }), ["paragraph-empty"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: ["a", 3] }), ["paragraph-not-text"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: ["a\n\nb"] }), ["paragraph-has-blank-line"])
  assert.deepEqual(rules({ medium: " Oil.", paragraphs: ["a "] }), ["untrimmed", "untrimmed"])
  assert.deepEqual(rules({ medium: "Oil.", paragraphs: ["a"], caption: "x" }), ["unknown-field"])
  for (const i of validateLabel({ medium: "", paragraphs: ["", "ok"] })) assert.ok(i.message.length > 10 && i.at.length > 0)
})

test("A1-34.2 one function renders the same label to the page, the record and the printed catalogue, with the same words", () => {
  const object = fixture().objects[0]
  for (const withObject of [false, true]) {
    const rendered = withObject ? renderLabel(LABEL, object, { base: "https://rohankhanna.com" }) : renderLabel(LABEL)
    assert.deepEqual(wordsOfPage(rendered.page), LABEL, "the page")
    assert.deepEqual(wordsOfRecord(rendered.record), LABEL, "the machine-readable record")
    assert.deepEqual(wordsOfPrint(rendered.print, withObject), LABEL, "the printed catalogue")
    const tokens = (s: string) => s.split(/\s+/).filter(Boolean)
    const all = tokens([LABEL.medium, ...LABEL.paragraphs].join(" "))
    assert.deepEqual(tokens(rendered.page.children.map((c) => c.text).join(" ")), all)
    const list = (rendered.record["ko:paragraphs"] as { "@list": string[] })["@list"]
    assert.deepEqual(tokens([rendered.record["ko:medium"] as string, ...list].join(" ")), all)
    assert.deepEqual(tokens(rendered.print).slice(withObject ? tokens(object.title).length : 0), all)
  }
})

test("A1-34.2 the record is the object's JSON-LD with the label's words added, and the order is the label's", () => {
  const object = fixture().objects[0]
  const { record, print, page } = renderLabel(LABEL, object, { base: "https://rohankhanna.com" })
  assert.equal(record.name, object.title)
  assert.equal(record["@id"], `https://rohankhanna.com/api/v1/objects/${object.id}`)
  assert.deepEqual(record["ko:paragraphs"], { "@list": LABEL.paragraphs }, "@list keeps the paragraphs in order")
  assert.ok(print.startsWith(`${object.title}\n${LABEL.medium}\n\n${LABEL.paragraphs[0]}`))
  assert.deepEqual(page.children.map((c) => c.role), ["medium", "paragraph", "paragraph"])
  assert.ok(print.indexOf(LABEL.medium) < print.indexOf(LABEL.paragraphs[0]), "medium line first")
  const bare = renderLabel(LABEL, object, { base: "https://rohankhanna.com" }).record
  const { "ko:medium": _m, "ko:paragraphs": _p, ...rest } = bare
  assert.equal(rest.description, object.summary)
})

test("A1-34.2 an invalid label is not rendered", () => {
  assert.throws(() => renderLabel({ medium: "", paragraphs: [] } as Label), /not a label/)
})

test("A1-34.2 a label made from the site's medium and body fields", () => {
  assert.deepEqual(labelFrom({ medium: LABEL.medium, body: LABEL.paragraphs }), LABEL)
  assert.equal(labelFrom({}), undefined)
  assert.deepEqual(rules(labelFrom({ medium: "Oil." })), ["paragraphs-missing"])
})

test("A1-34.2 the real fixture: every object that carries a label has a valid one; the rest are reported", () => {
  const objects = fixture().objects
  const audit = auditLabels(objects, (o) => labelFrom(o as { medium?: string; body?: string[] }))
  assert.equal(audit.ok.length + audit.missing.length + audit.invalid.length, objects.length)
  assert.deepEqual(audit.invalid, [], "no object has a label that breaks the structure")
  console.log(`  fixtures/rohankhanna: ${objects.length} objects, ${audit.ok.length} carry a valid label, ${audit.missing.length} carry none (SystemObject has no medium or body; the label lives beside it)`)
})

const SITE = join((process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir()), "lib/register.ts")
test("A1-34.2 the site's own entries: every entry with a page of its own has a valid label", { skip: !existsSync(SITE) && "the site is not checked out here" }, async () => {
  const { ENTRIES } = await import(pathToFileURL(SITE).href) as { ENTRIES: { id: string; slug?: string; medium?: string; body?: string[] }[] }
  const withPage = ENTRIES.filter((e) => e.slug)
  assert.ok(withPage.length > 0)
  const audit = auditLabels(withPage, labelFrom)
  assert.deepEqual(audit.missing.concat(audit.invalid.map((i) => i.id)), [], "every entry that has a page of its own has a label of the fixed structure")
})

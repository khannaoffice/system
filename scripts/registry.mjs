import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const specPath = join(root, "spec", "SPEC.md")
const registryPath = join(root, "tests", "conformance", "registry.json")

const PHASE = { "24.1": 1, "24.2": 1, "24.3": 2, "24.4": 4, "24.5": 3, "24.6": 2, "24.7": 4 }
const PHASE_OVERRIDE = { "C-24.4-1": 3 }

export function parseConformance(markdown) {
  const entries = []
  let group = null
  let n = 0
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^### (24\.\d) (.+)$/)
    if (heading) {
      group = heading[1]
      n = 0
      continue
    }
    if (/^#{1,3} /.test(line) || /^---$/.test(line)) {
      if (!heading) group = null
      continue
    }
    if (!group) continue
    const item = line.match(/^(?:- |\d+\. )(.+)$/)
    if (!item) continue
    n += 1
    const id = `C-${group}-${n}`
    entries.push({ id, group, source: "SPEC 24", text: item[1].trim(), phase: PHASE_OVERRIDE[id] ?? PHASE[group], status: "pending", test: null, requires: null, note: null })
  }
  return entries
}

const AMENDMENT_PHASE = { 31: 2, 32: 2, 33: 2, 34: 5 }
export function parseAmendment(markdown) {
  const out = []
  for (const line of markdown.split("\n")) {
    const m = line.match(/^(3[1-4])\.(\d+) (.+)$/)
    if (!m) continue
    out.push({ id: `A1-${m[1]}.${m[2]}`, group: m[1], source: "Amendment 0001", text: m[3].trim(), phase: AMENDMENT_PHASE[m[1]], status: "pending", test: null, requires: null, note: null })
  }
  return out
}

const MANUAL = [
  { id: "T-1", group: "test bench", source: "rohankhanna.com /test", text: "The unlisted /test room, where the owner and an agent work together, is driven in a real browser as both: the read API and MCP, the agent's WebMCP tools, authority and approval bound to the change, Gather, notes and claims, position and return, handing work over and back, persistence and starting over, and that nothing moves when the agent acts.", phase: 6, status: "pending", test: null, requires: null, note: null },
  { id: "L-1", group: "Local-first", source: "Local-first", text: "The core, the state package and the git adapter have no network, database or authentication-provider code or dependency.", phase: 4, status: "pending", test: null, requires: null, note: null },
  { id: "L-2", group: "Local-first", source: "Local-first", text: "Write state (grants, approvals, receipts, private collections, staged changes, the audit log) survives a restart on a local store, and a crash between the log and the state is detected.", phase: 4, status: "pending", test: null, requires: null, note: null },
  { id: "L-3", group: "Local-first", source: "Local-first", text: "A committed revision or published collection can be written as a versioned Git commit carrying its receipt, once, without sweeping in other work and without pushing.", phase: 4, status: "pending", test: null, requires: null, note: null },
  { id: "L-4", group: "Local-first", source: "Local-first", text: "A register can be built from files in a repository alone.", phase: 4, status: "pending", test: null, requires: null, note: null },
  { id: "S-29", group: "29", source: "SPEC 29", text: "The first complete reference scenario passes end to end.", phase: 6, status: "pending", test: null, requires: null, note: null },
]

export function build() {
  const amendmentPath = join(root, "spec", "amendments", "0001-intent-cadence-within-refusal.md")
  const fresh = [...parseConformance(readFileSync(specPath, "utf8")), ...parseAmendment(readFileSync(amendmentPath, "utf8")), ...MANUAL]
  const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : { entries: [] }
  const byId = new Map(previous.entries.map((e) => [e.id, e]))
  return {
    spec: "0.1.0",
    entries: fresh.map((e) => ({ ...e, status: byId.get(e.id)?.status ?? e.status, test: byId.get(e.id)?.test ?? e.test, requires: byId.get(e.id)?.requires ?? e.requires, note: byId.get(e.id)?.note ?? e.note })),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(registryPath, JSON.stringify(build(), null, 2) + "\n")
  console.log(`registry: ${build().entries.length} requirements`)
}

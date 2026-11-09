import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const target = process.argv[2] && resolve(process.argv[2])
const check = process.argv.includes("--check")
if (!target) throw new Error("usage: vendor.mjs <targetDir> [--check]")

const FILES = [
  ["packages/core/src/authority.ts", "authority.ts"],
  ["packages/core/src/operations.ts", "operations.ts"],
  ["packages/core/src/task.ts", "task.ts"],
  ["packages/core/src/annotation.ts", "annotation.ts"],
  ["packages/core/src/surface.ts", "surface.ts"],
  ["packages/state/src/store.ts", "store.ts"],
  ["packages/state/src/personal.ts", "personal.ts"],
  ["packages/state/src/world-store.ts", "world-store.ts"],
  ["packages/adapters/git/src/render.ts", "render.ts"],
  ["packages/core/src/core.ts", "core.ts"],
  ["packages/core/src/jsonld.ts", "jsonld.ts"],
  ["packages/core/src/position.ts", "position.ts"],
  ["packages/core/src/gather.ts", "gather.ts"],
  ["packages/core/src/warrant.ts", "warrant.ts"],
  ["packages/core/src/capabilities.ts", "capabilities.ts"],
  ["packages/core/src/reading.ts", "reading.ts"],
  ["packages/core/src/intent.ts", "intent.ts"],
  ["packages/core/src/cadence.ts", "cadence.ts"],
  ["packages/core/src/within.ts", "within.ts"],
  ["packages/core/src/refusal.ts", "refusal.ts"],
  ["packages/core/src/label.ts", "label.ts"],
  ["packages/core/src/maker.ts", "maker.ts"],
  ["packages/adapters/mcp/src/mcp.ts", "mcp.ts"],
  ["packages/adapters/webmcp/src/webmcp.ts", "webmcp.ts"],
]
const header = (source) => `// From khannaoffice/system ${source}. Change it there, then copy it here.\n`
const flatten = (text) => text.replace(/from "(?:(?:\.\.\/)+core\/src\/|\.\/)([a-z-]+)(?:\.ts)?"/g, 'from "./$1"')

let drifted = 0
if (!check) mkdirSync(target, { recursive: true })
for (const [source, file] of FILES) {
  const wanted = header(source) + flatten(readFileSync(join(root, source), "utf8"))
  const path = join(target, file)
  if (check) {
    const same = existsSync(path) && readFileSync(path, "utf8") === wanted
    if (!same) { console.error(`drifted: ${file}`); drifted += 1 }
  } else {
    writeFileSync(path, wanted)
    console.log(`vendored ${file}`)
  }
}
process.exit(drifted ? 1 : 0)

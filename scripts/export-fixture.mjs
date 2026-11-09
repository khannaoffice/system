import { writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const [base, out] = process.argv.slice(2)
if (!base || !out) throw new Error("usage: export-fixture.mjs <baseUrl> <outFile>")

const get = async (path) => {
  const res = await fetch(new URL(path, base), { redirect: "follow" })
  const body = await res.json()
  if (body.status !== "ok") throw new Error(`${path}: ${JSON.stringify(body)}`)
  return body.data
}

const root = await get("/api/v1/")
const objects = []
let cursor
do {
  const page = await get(`/api/v1/objects/?order=sequence:asc&limit=200${cursor ? `&cursor=${cursor}` : ""}`)
  objects.push(...page.items)
  cursor = page.nextCursor
} while (cursor)

const key = (r) => `${r.type}|${r.from}|${r.to}|${r.via ?? ""}`
const relations = new Map()
const revisions = {}
for (const o of objects) {
  for (const r of await get(`/api/v1/objects/${o.id}/relations/`)) relations.set(key(r), r)
  for (const rev of await get(`/api/v1/objects/${o.id}/revisions/`)) revisions[rev.revisionId] = rev
}
const collections = []
for (const c of root.collections) collections.push((await get(`/api/v1/collections/${c.id}/`)).collection)

const register = { scope: root.scope, objects, relations: [...relations.values()], collections, revisions, withdrawn: {} }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(register, null, 2) + "\n")
console.log(`fixture: ${objects.length} objects, ${register.relations.length} relations, ${collections.length} collections`)

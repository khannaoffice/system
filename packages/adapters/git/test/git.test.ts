import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { historyOf, publishToGit, pretty, readContent, renderChange } from "../src/git.ts"
import { approve, commit, perform, type Approval, type Receipt } from "../../../core/src/operations.ts"
import { listObjects, readCollection, readObject } from "../../../core/src/core.ts"
import { fixture } from "../../../core/test/helpers.ts"
import { mkdirSync } from "node:fs"
import { AGENT, makeWorld, OWNER, ok } from "../../../core/test/world.ts"

const AUTHOR = { name: "Rohan Khanna", email: "rohan@example.test" }
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim()
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ko-git-"))
  execFileSync("git", ["init", "-q", "-b", "main", dir])
  git(dir, "config", "user.name", "Someone Else")
  git(dir, "config", "user.email", "else@example.test")
  writeFileSync(join(dir, "README.md"), "site\n")
  git(dir, "add", "README.md")
  git(dir, "commit", "-q", "-m", "initial")
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

async function revise(w: ReturnType<typeof makeWorld>, id: string, title: string) {
  const o = w.world.register.objects.find((x) => x.id === id)!
  const staged = ok(await perform(w.world, AGENT, { capability: "ko_preview_change", arguments: { id, expectedRevision: o.revisionId, changes: { title } } })) as { receipt: Receipt }
  const req = { capability: "ko_commit_change", arguments: { proposalId: (staged.receipt.output as { proposalId: string }).proposalId } }
  const prepared = await perform(w.world, AGENT, req) as any
  const a = ok(await approve(w.world, OWNER, prepared.error.details.operationId)) as Approval
  return ((ok(await commit(w.world, AGENT, req, a.id)) as { receipt: Receipt }).receipt).operationId
}

test("L-3 an approved change becomes one Git commit carrying its receipt, and the files are the object", async () => {
  const w = makeWorld(); w.grant(["revise"])
  const { dir, cleanup } = repo()
  try {
    const o = w.world.register.objects[2]
    const op = await revise(w, o.id, "A better title")
    const out = publishToGit(w.world, op, { repoDir: dir, author: AUTHOR })
    assert.equal(out.created, true)
    assert.equal(git(dir, "rev-list", "--count", "HEAD"), "2", "one new commit on top of the initial one")
    const message = git(dir, "log", "-1", "--format=%B")
    assert.match(message, /^Revise A better title/)
    for (const t of [`KO-Operation: ${op}`, "KO-Capability: ko_commit_change", `KO-Principal: ${OWNER.id}`, `KO-Actor: ${AGENT.id}`, "KO-Approval: ", "KO-Receipt: ", "KO-Revision: sha256:"]) assert.ok(message.includes(t), `the message carries ${t}`)
    assert.equal(git(dir, "log", "-1", "--format=%an <%ae>"), "Rohan Khanna <rohan@example.test>", "authored as the person, not as the machine's git identity")

    const current = (readObject(w.world.register, o.id) as any).data
    assert.equal(readFileSync(join(dir, "content/objects", `${o.id}.json`), "utf8"), pretty(current), "the file is exactly the object")
    assert.ok(readdirSync(join(dir, "content/revisions")).length === 1)
    assert.equal(readContent(dir).objects[0].title, "A better title", "and published content reads back from the files")
    assert.equal(readContent(dir).objects[0].previousRevisionId, o.revisionId, "with its lineage")
    assert.equal(git(dir, "remote"), "", "no remote was touched, because none was needed")
  } finally { cleanup() }
})

test("L-3 committing the same operation twice is a no-op, and unrelated work in the repository is left alone", async () => {
  const w = makeWorld(); w.grant(["revise"])
  const { dir, cleanup } = repo()
  try {
    const op = await revise(w, w.world.register.objects[2].id, "Once")
    writeFileSync(join(dir, "staged.txt"), "mine\n"); git(dir, "add", "staged.txt")
    writeFileSync(join(dir, "README.md"), "changed but not staged\n")
    const first = publishToGit(w.world, op, { repoDir: dir, author: AUTHOR })
    const second = publishToGit(w.world, op, { repoDir: dir, author: AUTHOR })
    assert.deepEqual([first.created, second.created, second.sha === first.sha], [true, false, true])
    assert.equal(git(dir, "rev-list", "--count", "HEAD"), "2", "still one new commit")
    assert.equal(git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").every((f) => f.startsWith("content/")), true, "only content files are in the commit")
    assert.equal(git(dir, "diff", "--cached", "--name-only"), "staged.txt", "the other staged file was not swept in")
    assert.match(git(dir, "status", "--porcelain"), /M README\.md/, "and the other unstaged change is still there")
  } finally { cleanup() }
})

test("L-3 a published collection is a file too, and history lists every receipt", async () => {
  const w = makeWorld(); w.grant(["collection:write", "publish", "revise"])
  const { dir, cleanup } = repo()
  try {
    const made = ok(await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Studies" } })) as { receipt: Receipt }
    const id = (made.receipt.output as { id: string }).id
    ok(await perform(w.world, AGENT, { capability: "ko_add_to_collection", arguments: { id, objectIds: [w.world.register.objects[0].id], basis: "evidenced" } }))
    const req = { capability: "ko_publish_collection", arguments: { id } }
    const prepared = await perform(w.world, AGENT, req) as any
    const a = ok(await approve(w.world, OWNER, prepared.error.details.operationId)) as Approval
    const done = ok(await commit(w.world, AGENT, req, a.id)) as { receipt: Receipt }
    const out = publishToGit(w.world, done.receipt.operationId, { repoDir: dir, author: AUTHOR })
    assert.deepEqual(out.files, [`content/collections/${id}.json`])
    const [c] = readContent(dir).collections
    assert.deepEqual([c.id, c.visibility, c.kind, c.members[0].basis], [id, "public", "published", "evidenced"])
    const op2 = await revise(w, w.world.register.objects[5].id, "Second")
    publishToGit(w.world, op2, { repoDir: dir, author: AUTHOR })
    const history = historyOf(dir)
    assert.deepEqual(history.map((h) => h.capability).sort(), ["ko_commit_change", "ko_publish_collection"])
    assert.ok(history.every((h) => h.principal === OWNER.id && h.actor === AGENT.id), "who, and on whose behalf, from the history alone")
    assert.match(git(dir, "log", "-1", "--format=%B", out.sha), /KO-Revision: sha256:[0-9a-f]{64}/, "a version of exactly what was published")
  } finally { cleanup() }
})

test("L-3 private state is never written to the repository, and nothing unsafe becomes a path", async () => {
  const w = makeWorld(); w.grant(["collection:write", "annotation:write"])
  const made = ok(await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Private" } })) as { receipt: Receipt }
  const note = ok(await perform(w.world, AGENT, { capability: "ko_create_annotation", arguments: { objectId: w.world.register.objects[0].id, body: "secret" } })) as { receipt: Receipt }
  for (const op of [made.receipt.operationId, note.receipt.operationId]) assert.throws(() => renderChange(w.world, op), /private state, not published content/)
  assert.throws(() => renderChange(w.world, "ko-nothing"), /No receipt/)
  for (const evilId of ["../../etc/passwd", "ko-ok/../../x", "..", "a b", "KO-UPPER", ""]) {
    const evilCollection = { ...w.world.register.collections[0], id: evilId, visibility: "public" as const }
    const forged = { ...w.world, register: { ...w.world.register, collections: [evilCollection] }, receipts: { evil: { ...made.receipt, capability: "ko_publish_collection", after: { [evilId]: "public" } } } } as never
    assert.throws(() => renderChange(forged, "evil"), /Refusing to write a file/, `"${evilId}" must never become a path`)
  }
  const src = readFileSync(new URL("../src/git.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  assert.ok(!/["']push["']|["']remote["']|["']fetch["']|["']pull["']|["']clone["']/.test(src), "the adapter has no way to send a change anywhere")
})

test("pretty() is stable: the same record is always the same bytes", () => {
  assert.equal(pretty({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } }), '{\n  "a": {\n    "c": [\n      3,\n      {\n        "z": 1\n      }\n    ],\n    "d": 2\n  },\n  "b": 1\n}\n')
  assert.equal(pretty({ a: 1, b: 2 }), pretty({ b: 2, a: 1 }))
})

test("L-4 a register can be built from files in a repository alone, and answers as the original did", () => {
  const original = fixture()
  const { dir, cleanup } = repo()
  try {
    mkdirSync(join(dir, "content/objects"), { recursive: true })
    mkdirSync(join(dir, "content/collections"), { recursive: true })
    for (const o of original.objects) writeFileSync(join(dir, "content/objects", `${o.id}.json`), pretty(o))
    for (const c of original.collections) writeFileSync(join(dir, "content/collections", `${c.id}.json`), pretty(c))
    const content = readContent(dir)
    const rebuilt = { scope: original.scope, objects: content.objects, relations: original.relations, collections: content.collections, revisions: Object.fromEntries(content.objects.map((o) => [o.revisionId, o])), withdrawn: {} }
    assert.equal(rebuilt.objects.length, original.objects.length)
    for (const order of ["date:desc", "date:asc", "title:asc", "sequence:asc"]) {
      assert.deepEqual(listObjects(rebuilt, { order, limit: 200 }), listObjects(original, { order, limit: 200 }), `${order}: the same list, in the same order`)
    }
    for (const c of original.collections) assert.deepEqual(readCollection(rebuilt, c.id), readCollection(original, c.id), `${c.title}: the same thread`)
    for (const o of original.objects) assert.deepEqual((readObject(rebuilt, o.id) as any).data, o, `${o.title}: the same object`)
  } finally { cleanup() }
})

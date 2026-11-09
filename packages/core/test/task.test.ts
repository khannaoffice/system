import { test } from "node:test"
import assert from "node:assert/strict"
import { approve, commit, perform, type Approval, type Receipt } from "../src/operations.ts"
import { advance, attach, createTask, handoff, isTerminal, outcomeOf, resumeTask, TRANSITIONS } from "../src/task.ts"
import { AGENT, makeWorld, OWNER, ok, code } from "./world.ts"

async function waiting() {
  const w = makeWorld()
  const g = w.grant(["collection:write", "publish", "revise"])
  const task = createTask(w.world, AGENT, OWNER.id, "Gather the studies and publish them")
  const made = ok(await perform(w.world, AGENT, { capability: "ko_create_collection", arguments: { title: "Studies" } }, { taskId: task.id })) as { receipt: Receipt }
  attach(w.world, task.id, made.receipt.operationId)
  const id = (made.receipt.output as { id: string }).id
  ok(await perform(w.world, AGENT, { capability: "ko_add_to_collection", arguments: { id, objectIds: [w.world.register.objects[0].id] } }))
  const req = { capability: "ko_publish_collection", arguments: { id } }
  const prepared = await perform(w.world, AGENT, req, { taskId: task.id }) as any
  attach(w.world, task.id, prepared.error.details.operationId)
  for (const s of ["discovering", "proposing", "awaiting_approval"] as const) ok(advance(w.world, task.id, s))
  return { ...w, task, g, id, req, opId: prepared.error.details.operationId as string }
}

test("a task moves only along allowed transitions, and terminal states stay terminal", () => {
  const { world } = makeWorld()
  const t = createTask(world, AGENT, OWNER.id, "x")
  assert.equal(code(advance(world, t.id, "executing") as any), "failed/invalid_state", "it cannot skip ahead")
  for (const s of ["discovering", "proposing"] as const) ok(advance(world, t.id, s))
  ok(advance(world, t.id, "cancelled"))
  for (const s of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[]) assert.equal(code(advance(world, t.id, s) as any), "failed/invalid_state", `nothing leaves cancelled (${s})`)
  assert.ok(isTerminal("completed") && isTerminal("failed") && isTerminal("cancelled") && !isTerminal("paused"))
  assert.equal(code(advance(world, "ko-notask", "created") as any), "failed/not_found")
})

test("awaiting approval needs something to await, and executing needs a valid approval", async () => {
  const w = makeWorld()
  const t = createTask(w.world, AGENT, OWNER.id, "x")
  ok(advance(w.world, t.id, "discovering")); ok(advance(w.world, t.id, "proposing"))
  assert.equal(code(advance(w.world, t.id, "awaiting_approval") as any), "failed/invalid_state", "there is no prepared operation")

  const s = await waiting()
  assert.equal(code(advance(s.world, s.task.id, "executing") as any), "failed/approval_required", "it cannot execute unapproved")
  const approval = ok(await approve(s.world, OWNER, s.opId)) as Approval
  s.tick(16 * 60_000)
  assert.equal(code(advance(s.world, s.task.id, "executing") as any), "failed/approval_required", "an expired approval does not count")
  void approval
})

test("finishing a task is not the same as every operation in it succeeding", async () => {
  const s = await waiting()
  const approval = ok(await approve(s.world, OWNER, s.opId)) as Approval
  ok(advance(s.world, s.task.id, "executing"))
  assert.equal(code(await commit(s.world, AGENT, s.req, approval.id) as any), "ok")
  ok(advance(s.world, s.task.id, "verifying")); ok(advance(s.world, s.task.id, "completed"))
  assert.equal(outcomeOf(s.world, s.task.id).allSucceeded, true)

  const t = await waiting()
  const { cancel } = await import("../src/operations.ts")
  assert.equal(cancel(t.world, AGENT, t.opId).status, "cancelled")
  assert.equal(code(advance(t.world, t.task.id, "completed") as any), "failed/invalid_state", "the cancelled operation no longer awaits, but completed is not reachable from here")
  ok(advance(t.world, t.task.id, "proposing")); ok(advance(t.world, t.task.id, "executing")); ok(advance(t.world, t.task.id, "verifying")); ok(advance(t.world, t.task.id, "completed"))
  const outcome = outcomeOf(t.world, t.task.id)
  assert.equal(t.task.state, "completed")
  assert.equal(outcome.allSucceeded, false, "completed, but not every operation worked")
  assert.equal(outcome.cancelled, 1)
})

test("C-24.4-8 a resumed task revalidates its grants, authority and revisions", async () => {
  const a = await waiting()
  ok(advance(a.world, a.task.id, "paused"))
  a.g.revokedAt = a.clock()
  const blocked = await resumeTask(a.world, a.task.id, AGENT) as any
  assert.equal(blocked.status, "conflict")
  assert.equal(a.task.state, "blocked")
  assert.ok(a.task.blockedBy!.length > 0 && /revoked|permission|grant/i.test(a.task.blockedBy!.join(" ")), a.task.blockedBy!.join("; "))
  a.g.revokedAt = undefined
  const back = ok(await resumeTask(a.world, a.task.id, AGENT)) as { state: string }
  assert.equal(back.state, "awaiting_approval", "it goes back to what it was doing")

  const b = await waiting()
  ok(advance(b.world, b.task.id, "paused"))
  b.tick(2 * 3600_000)
  assert.equal(code(await resumeTask(b.world, b.task.id, AGENT) as any), "conflict/not_permitted", "an expired grant blocks it")

  const c = await waiting()
  ok(advance(c.world, c.task.id, "paused"))
  ok(await perform(c.world, AGENT, { capability: "ko_add_to_collection", arguments: { id: c.id, objectIds: [c.world.register.objects[1].id] } }))
  const r = await resumeTask(c.world, c.task.id, AGENT) as any
  assert.equal(r.status, "conflict", "the collection changed while the task was paused")
  assert.equal(c.task.state, "blocked")
  assert.ok(c.task.blockedBy!.some((m) => /changed since it was prepared/.test(m)), c.task.blockedBy!.join("; "))

  const d = await waiting()
  assert.equal(code(await resumeTask(d.world, d.task.id, AGENT) as any), "failed/invalid_state")
})

test("a handoff says what is done, what is pending, and what is needed, before anyone resumes", async () => {
  const s = await waiting()
  const h = handoff(s.world, s.task.id)
  assert.equal(h.task.state, "awaiting_approval")
  assert.deepEqual(h.completed.map((c) => c.capability), ["ko_create_collection"])
  assert.equal(h.pending?.capability, "ko_publish_collection")
  assert.match(h.pending!.effects[0], /Make the collection "Studies" public/)
  assert.equal(h.requiredFromHuman, `Approval by ${OWNER.id}.`)
  assert.deepEqual(h.authority[0].scopes, ["collection:write", "publish", "revise"])
  assert.ok(h.resume.includes(s.task.id))
  assert.ok(h.objects.some((o) => o.objectId === s.id), "the collection and its revision state are named")
})

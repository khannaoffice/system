import { revalidate, type Task, type TaskState, type World, type WriteResult } from "./operations.ts"
import type { Participant } from "./authority.ts"
import type { ErrorCode } from "./core.ts"

export const TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ["discovering", "cancelled"],
  discovering: ["proposing", "paused", "blocked", "failed", "cancelled"],
  proposing: ["awaiting_approval", "executing", "paused", "blocked", "failed", "cancelled"],
  awaiting_approval: ["executing", "proposing", "paused", "blocked", "failed", "cancelled"],
  executing: ["verifying", "paused", "blocked", "failed", "cancelled"],
  verifying: ["completed", "executing", "blocked", "failed"],
  paused: ["discovering", "proposing", "awaiting_approval", "executing", "verifying", "blocked", "cancelled"],
  blocked: ["discovering", "proposing", "awaiting_approval", "executing", "verifying", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
}

export const isTerminal = (s: TaskState) => TRANSITIONS[s].length === 0
const bad = (code: ErrorCode, message: string, details?: Record<string, unknown>): WriteResult<never> => ({ status: "failed", error: { code, message, ...(details ? { details } : {}) } })

export function createTask(world: World, actor: Participant, principal: string, goal: string): Task {
  const task: Task = { id: world.ids(), principal, actor: actor.id, goal, state: "created", operations: [], createdAt: world.clock() }
  world.tasks[task.id] = task
  return task
}

export function attach(world: World, taskId: string, operationId: string): void {
  const task = world.tasks[taskId]
  task.operations.push(operationId)
  if (world.operations[operationId]?.status === "awaiting_approval") task.pending = operationId
}

const approved = (world: World, operationId: string) =>
  Object.values(world.approvals).some((a) => a.operationId === operationId && !a.usedAt && a.expiresAt > world.clock())

export function advance(world: World, taskId: string, to: TaskState): WriteResult<Task> {
  const task = world.tasks[taskId]
  if (!task) return bad("not_found", `No task ${taskId}.`)
  if (!TRANSITIONS[task.state].includes(to)) return bad("invalid_state", `A task cannot go from ${task.state} to ${to}.`, { from: task.state, allowed: TRANSITIONS[task.state] })

  if (to === "awaiting_approval" && !(task.pending && world.operations[task.pending]?.status === "awaiting_approval")) {
    return bad("invalid_state", "Nothing is awaiting approval: there is no prepared operation.")
  }
  if (to === "executing" && task.state === "awaiting_approval" && !(task.pending && approved(world, task.pending))) {
    return bad("approval_required", "It cannot execute until its pending operation has a valid approval.", { operationId: task.pending })
  }
  if (to === "completed" && task.pending && world.operations[task.pending]?.status === "awaiting_approval") {
    return bad("invalid_state", "It cannot complete while an operation still awaits approval.")
  }
  if (to === "paused" || to === "blocked") task.resumeTo = task.state
  if (to === "completed" || to === "failed" || to === "cancelled") delete task.pending
  task.state = to
  world.events.push({ eventId: world.ids(), type: "task.advanced", occurredAt: world.clock(), actorId: task.actor, taskId: task.id, resourceIds: [], payload: { to }, schemaVersion: "0.1.0" })
  return { status: "ok", data: task }
}

export function outcomeOf(world: World, taskId: string) {
  const ops = world.tasks[taskId].operations.map((id) => world.operations[id])
  const count = (s: string) => ops.filter((o) => o.status === s).length
  return { committed: count("committed"), failed: count("failed"), cancelled: count("cancelled"), unknown: count("unknown"), allSucceeded: ops.length > 0 && ops.every((o) => o.status === "committed") }
}

export async function resumeTask(world: World, taskId: string, actor: Participant): Promise<WriteResult<Task>> {
  const task = world.tasks[taskId]
  if (!task) return bad("not_found", `No task ${taskId}.`)
  if (task.state !== "paused" && task.state !== "blocked") return bad("invalid_state", `A ${task.state} task is not resumable.`)
  const reasons: { code: ErrorCode; message: string }[] = []

  const used = new Set(task.operations.map((id) => world.receipts[id]?.authorization.grant).filter((g): g is string => !!g))
  for (const id of used) {
    const grant = world.grants.find((g) => g.id === id)
    const now = world.clock()
    if (!grant || (grant.revokedAt !== undefined && grant.revokedAt <= now)) reasons.push({ code: "not_permitted", message: `Grant ${id} has been revoked.` })
    else if (grant.expiresAt <= now) reasons.push({ code: "not_permitted", message: `Grant ${id} has expired.` })
  }
  const pending = task.pending ? world.preparations[task.pending] : undefined
  if (pending) reasons.push(...(await revalidate(world, actor, pending)))

  if (reasons.length) {
    task.resumeTo ??= task.state === "blocked" ? "proposing" : task.state
    task.state = "blocked"
    task.blockedBy = reasons.map((r) => r.message)
    return { status: "conflict", error: { code: reasons[0].code, message: `The task cannot resume: ${reasons[0].message}`, details: { taskId, blockedBy: task.blockedBy, task } } }
  }
  task.state = task.resumeTo ?? "proposing"
  delete task.resumeTo
  delete task.blockedBy
  return { status: "ok", data: task }
}

export function handoff(world: World, taskId: string) {
  const task = world.tasks[taskId]
  const ops = task.operations.map((id) => world.operations[id])
  const pending = task.pending ? world.preparations[task.pending] : undefined
  const touched = new Map<string, string | null>()
  for (const id of task.operations) for (const [obj, rev] of Object.entries(world.receipts[id]?.after ?? {})) touched.set(obj, rev)
  for (const [obj, rev] of Object.entries(pending?.expectedRevisions ?? {})) if (!obj.startsWith("proposal:")) touched.set(obj, rev)
  return {
    task: { id: task.id, goal: task.goal, state: task.state, resumeTo: task.resumeTo ?? null, blockedBy: task.blockedBy ?? [] },
    completed: ops.filter((o) => o.status === "committed").map((o) => ({ operationId: o.id, capability: o.capability })),
    pending: pending ? { operationId: pending.operationId, capability: pending.capability, effects: pending.effects, expiresAt: pending.expiresAt } : null,
    objects: [...touched].map(([objectId, revisionId]) => ({ objectId, revisionId })),
    requiredFromHuman: pending ? `Approval by ${pending.principal}.` : null,
    authority: world.grants.filter((g) => g.actor === task.actor && g.principal === task.principal).map((g) => ({ grantId: g.id, scopes: g.scopes, expiresAt: g.expiresAt, revokedAt: g.revokedAt ?? null })),
    resume: `resumeTask(${task.id})`,
  }
}

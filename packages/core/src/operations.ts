import { CAPABILITIES, needsApprovalFor, validate, type Capability, type OperationRequest } from "./capabilities.ts"
import { authorize, mayApprove, type AuthContext, type Decision, type Grant, type Participant } from "./authority.ts"
import { canonicalJson, appendRevision, revisionContent, SYSTEM_VERSION, type Collection, type ErrorCode, type OperationError, type Register, type SystemObject } from "./core.ts"
import { emptyPositions, setPosition, type Position, type Positions } from "./position.ts"

export type WriteStatus = "ok" | "failed" | "denied" | "conflict" | "cancelled" | "unknown" | "needs_approval"
export type WriteResult<T> =
  | { status: "ok"; data: T }
  | { status: "cancelled"; data: T }
  | { status: Exclude<WriteStatus, "ok" | "cancelled">; error: OperationError }

const stop = (status: Exclude<WriteStatus, "ok" | "cancelled">, code: ErrorCode, message: string, details?: Record<string, unknown>): WriteResult<never> => ({
  status, error: { code, message, ...(details ? { details } : {}) },
})

export interface EventEnvelope {
  eventId: string
  type: string
  occurredAt: string
  actorId: string
  taskId?: string
  operationId?: string
  resourceIds: string[]
  causationId?: string
  payload: Record<string, unknown>
  schemaVersion: typeof SYSTEM_VERSION
}

export type OperationStatus = "awaiting_approval" | "committed" | "cancelled" | "failed" | "unknown"

export interface Preparation {
  operationId: string
  capability: string
  version: number
  arguments: unknown
  actor: string
  principal: string
  effects: string[]
  expectedRevisions: Record<string, string>
  digest: string
  preparedAt: string
  expiresAt: string
  taskId?: string
}

export interface Approval {
  id: string
  operationId: string
  digest: string
  approvedBy: string
  approvedAt: string
  expiresAt: string
  usedAt?: string
}

export interface OperationRecord {
  id: string
  status: OperationStatus
  capability: string
  actor: string
  principal: string
  preparedAt: string
  settledAt?: string
}

export interface Receipt {
  id: string
  operationId: string
  capability: string
  version: number
  actor: string
  principal: string
  authorization: { decision: "allow"; grant?: string }
  approval?: string
  before: Record<string, string | null>
  after: Record<string, string | null>
  outcome: "committed"
  at: string
  output?: unknown
}

export interface Annotation {
  id: string
  objectId: string
  revisionId: string
  body: string
  author: string
  principal: string
  origin: "person" | "agent" | "process"
  visibility: "private"
  createdAt: string
}

export interface Proposal {
  id: string
  objectId: string
  expectedRevision: string
  changes: Partial<Pick<SystemObject, "title" | "summary" | "date">>
  proposedBy: string
  proposerKind: Participant["kind"]
  principal: string
  status: "draft" | "committed"
  createdAt: string
}

export interface Task {
  id: string
  principal: string
  actor: string
  goal: string
  state: TaskState
  resumeTo?: TaskState
  operations: string[]
  pending?: string
  blockedBy?: string[]
  createdAt: string
}

export type TaskState = "created" | "discovering" | "proposing" | "awaiting_approval" | "executing" | "verifying" | "completed" | "paused" | "blocked" | "failed" | "cancelled"

export interface World {
  register: Register
  grants: Grant[]
  owner: string
  clock: () => string
  ids: () => string
  annotations: Annotation[]
  proposals: Record<string, Proposal>
  operations: Record<string, OperationRecord>
  preparations: Record<string, Preparation>
  approvals: Record<string, Approval>
  receipts: Record<string, Receipt>
  idempotency: Record<string, { digest: string; operationId: string }>
  tasks: Record<string, Task>
  positions: Positions
  events: EventEnvelope[]
  faults?: { failReceiptWrite?: boolean }
}

export function newWorld(register: Register, owner: string, options: { clock?: () => string; ids?: () => string } = {}): World {
  let n = 0
  return {
    register, owner, grants: [],
    clock: options.clock ?? (() => new Date().toISOString()),
    ids: options.ids ?? (() => `ko-${(++n).toString(36).padStart(10, "0")}`),
    annotations: [], proposals: {}, operations: {}, preparations: {}, approvals: {}, receipts: {}, idempotency: {}, tasks: {}, positions: emptyPositions(), events: [],
  }
}

const slotOf = (actor: string, capability: string, key: string) => `${actor}:${capability}:${key}`
const requestDigest = (request: OperationRequest, actor: string) =>
  sha256(canonicalJson({ capability: request.capability, version: request.version ?? capabilityOf(request.capability)?.version, arguments: request.arguments ?? {}, actor }))

async function replayOf(world: World, actor: Participant, request: OperationRequest, key: string | undefined): Promise<WriteResult<unknown> | null> {
  if (key === undefined) return null
  const seen = world.idempotency[slotOf(actor.id, request.capability, key)]
  if (!seen) return null
  if (seen.digest !== (await requestDigest(request, actor.id))) return stop("conflict", "idempotency_conflict", "That idempotency key was used for a different request.", { key })
  const receipt = world.receipts[seen.operationId]
  return receipt ? { status: "ok", data: { receipt, replayed: true } } : stop("unknown", "unverified", "The earlier attempt's outcome could not be confirmed.", { operationId: seen.operationId })
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return "sha256:" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function record(world: World, type: string, actorId: string, extra: Partial<EventEnvelope> & { payload?: Record<string, unknown> } = {}): EventEnvelope {
  const event: EventEnvelope = {
    eventId: world.ids(), type, occurredAt: world.clock(), actorId, resourceIds: [], payload: {}, schemaVersion: SYSTEM_VERSION, ...extra,
  }
  world.events.push(event)
  return event
}

const redact = async (args: unknown) => ({
  argumentsDigest: await sha256(canonicalJson(args ?? {})),
  argumentNames: args && typeof args === "object" ? Object.keys(args as object).sort() : [],
})

const ctxOf = (world: World, actor: Participant, origin?: string): AuthContext => ({ actor, grants: world.grants, owner: world.owner, now: world.clock(), origin })

export const WRITE_PERFORMED = new Set([
  "ko_create_collection", "ko_add_to_collection", "ko_reorder_collection", "ko_create_annotation",
  "ko_set_position", "ko_preview_change", "ko_commit_change", "ko_publish_collection",
])

const collectionOf = (world: World, id: string) => world.register.collections.find((c) => c.id === id)
const objectOf = (world: World, id: string) => world.register.objects.find((o) => o.id === id)

interface Plan {
  effects: string[]
  expected: Record<string, string>
  targets: string[]
  resource: string
  apply: (ctx: { actor: Participant; principal: string }) => Promise<{ before: Record<string, string | null>; after: Record<string, string | null>; output?: unknown }>
}

type Planned = { plan: Plan } | { error: WriteResult<never> }
const refuse = (status: Exclude<WriteStatus, "ok" | "cancelled">, code: ErrorCode, message: string, details?: Record<string, unknown>): Planned => ({ error: stop(status, code, message, details) })

async function plan(world: World, capability: Capability, args: Record<string, any>, actor: Participant): Promise<Planned> {
  switch (capability.id) {
    case "ko_create_collection":
      return { plan: {
        effects: [`Create a private collection titled "${args.title}".`], expected: {}, targets: [], resource: "*",
        async apply({ actor: who, principal }) {
          const id = world.ids()
          const provenance = who.kind === "human" ? { method: "authored" as const, recordedBy: who.id } : { method: "derived" as const, recordedBy: who.id, source: `assembled by ${who.id} for ${principal}` }
          const c: Collection = { schemaVersion: SYSTEM_VERSION, id, kind: "gathered", title: args.title, visibility: "private", orderKey: "position", members: [], provenance }
          world.register = { ...world.register, collections: [...world.register.collections, c] }
          return { before: { [id]: null }, after: { [id]: id }, output: { id } }
        },
      } }

    case "ko_add_to_collection": {
      const c = collectionOf(world, args.id)
      if (!c) return refuse("failed", "not_found", `No collection ${args.id}.`, { id: args.id })
      const missing = (args.objectIds as string[]).filter((o) => !objectOf(world, o) || o in world.register.withdrawn)
      if (missing.length) return refuse("failed", "not_found", `No such objects: ${missing.join(", ")}.`, { missing })
      return { plan: {
        effects: [`Add ${args.objectIds.length} object(s) to the collection "${c.title}".`], expected: {}, targets: [c.id], resource: c.id,
        async apply({ actor: who }) {
          const have = new Set(c.members.map((m) => m.objectId))
          const added = (args.objectIds as string[]).filter((o, i, all) => !have.has(o) && all.indexOf(o) === i)
          const basis = (args.basis as "authored" | "evidenced" | "inferred" | undefined) ?? (who.kind === "human" ? "authored" : "inferred")
          const members = [...c.members, ...added.map((objectId, i) => ({ objectId, position: c.members.length + i, basis }))]
          world.register = { ...world.register, collections: world.register.collections.map((x) => (x.id === c.id ? { ...c, members } : x)) }
          return { before: { [c.id]: String(c.members.length) }, after: { [c.id]: String(members.length) }, output: { added } }
        },
      } }
    }

    case "ko_reorder_collection": {
      const c = collectionOf(world, args.id)
      if (!c) return refuse("failed", "not_found", `No collection ${args.id}.`, { id: args.id })
      if (!c.members.some((m) => m.objectId === args.objectId)) return refuse("failed", "not_found", `${args.objectId} is not in the collection.`)
      return { plan: {
        effects: [`Move one object to position ${args.position} in "${c.title}".`], expected: {}, targets: [c.id], resource: c.id,
        async apply() {
          const ordered = [...c.members].sort((a, b) => a.position - b.position)
          const from = ordered.findIndex((m) => m.objectId === args.objectId)
          const [moved] = ordered.splice(from, 1)
          ordered.splice(Math.min(args.position, ordered.length), 0, moved)
          const members = ordered.map((m, position) => ({ ...m, position }))
          world.register = { ...world.register, collections: world.register.collections.map((x) => (x.id === c.id ? { ...c, members } : x)) }
          return { before: { [c.id]: String(from) }, after: { [c.id]: String(members.findIndex((m) => m.objectId === args.objectId)) } }
        },
      } }
    }

    case "ko_create_annotation": {
      const o = objectOf(world, args.objectId)
      if (!o || args.objectId in world.register.withdrawn) return refuse("failed", "not_found", `No object ${args.objectId}.`, { id: args.objectId })
      if (args.revisionId && args.revisionId !== o.revisionId && !(args.revisionId in world.register.revisions)) return refuse("failed", "revision_not_found", `Object ${o.id} has no revision ${args.revisionId}.`)
      return { plan: {
        effects: [`Write a private annotation on "${o.title}".`], expected: {}, targets: [o.id], resource: "*",
        async apply({ actor: who, principal }) {
          const id = world.ids()
          world.annotations.push({ id, objectId: o.id, revisionId: args.revisionId ?? o.revisionId, body: args.body, author: who.id, principal, origin: who.kind === "human" ? "person" : who.kind === "agent" ? "agent" : "process", visibility: "private", createdAt: world.clock() })
          return { before: { [id]: null }, after: { [id]: id }, output: { id } }
        },
      } }
    }

    case "ko_set_position": {
      if (args.participantId !== undefined && args.participantId !== actor.id) return refuse("denied", "not_permitted", "A participant moves only their own position.")
      return { plan: { effects: ["Move your own position."], expected: {}, targets: [], resource: "*",
        async apply({ actor: who }) { world.positions = setPosition(world.positions, who.id, { ...args.position, capturedAt: world.clock() } as Position); return { before: {}, after: {} } } } }
    }

    case "ko_preview_change": {
      const o = objectOf(world, args.id)
      if (!o || args.id in world.register.withdrawn) return refuse("failed", "not_found", `No object ${args.id}.`, { id: args.id })
      if (o.revisionId !== args.expectedRevision) return refuse("conflict", "stale_revision", `${o.id} has moved on from the revision this was written against.`, { expected: args.expectedRevision, current: o.revisionId })
      return { plan: {
        effects: [`Stage a draft change to "${o.title}". Nothing is published.`], expected: { [o.id]: o.revisionId }, targets: [o.id], resource: o.id,
        async apply({ actor: who, principal }) {
          const id = world.ids()
          world.proposals[id] = { id, objectId: o.id, expectedRevision: o.revisionId, changes: args.changes, proposedBy: who.id, proposerKind: who.kind, principal, status: "draft", createdAt: world.clock() }
          return { before: {}, after: {}, output: { proposalId: id, changes: Object.keys(args.changes) } }
        },
      } }
    }

    case "ko_commit_change": {
      const proposal = world.proposals[args.proposalId]
      if (!proposal) return refuse("failed", "not_found", `No proposal ${args.proposalId}.`, { id: args.proposalId })
      if (proposal.status === "committed") return refuse("failed", "invalid_state", "That proposal has already been committed.")
      const o = objectOf(world, proposal.objectId)
      if (!o) return refuse("failed", "not_found", `No object ${proposal.objectId}.`)
      if (o.revisionId !== proposal.expectedRevision) return refuse("conflict", "stale_revision", `${o.id} changed after this was proposed.`, { expected: proposal.expectedRevision, current: o.revisionId })
      const shown = (Object.keys(proposal.changes) as (keyof Proposal["changes"])[]).map((k) => `${k}: ${JSON.stringify(o[k] ?? null)} \u2192 ${JSON.stringify(proposal.changes[k])}`)
      return { plan: {
        effects: [`Publish a new revision of "${o.title}".`, ...shown, `The previous revision stays readable.`],
        expected: { [o.id]: o.revisionId, [`proposal:${proposal.id}`]: await sha256(canonicalJson(proposal.changes)) }, targets: [o.id], resource: o.id,
        async apply({ principal }) {
          const byPerson = proposal.proposerKind === "human"
          const next: SystemObject = {
            ...o, ...proposal.changes, previousRevisionId: o.revisionId, revisionId: "",
            provenance: byPerson ? { method: "authored", recordedBy: proposal.proposedBy } : { method: "derived", recordedBy: proposal.proposedBy, source: `proposed by ${proposal.proposedBy}, approved by ${principal}` },
          }
          next.revisionId = await sha256(revisionContent(next))
          world.register = appendRevision(world.register, next)
          proposal.status = "committed"
          return { before: { [o.id]: o.revisionId }, after: { [o.id]: next.revisionId }, output: { revisionId: next.revisionId } }
        },
      } }
    }

    case "ko_publish_collection": {
      const c = collectionOf(world, args.id)
      if (!c) return refuse("failed", "not_found", `No collection ${args.id}.`, { id: args.id })
      if (c.visibility === "public") return refuse("failed", "invalid_state", "That collection is already public.")
      const leaks = c.members.map((m) => objectOf(world, m.objectId)).filter((o) => !o || o.visibility !== "public").map((o) => o?.id ?? "missing")
      if (leaks.length) return refuse("denied", "not_permitted", "A collection cannot be published while it holds objects that are not public.", { objects: leaks })
      return { plan: {
        effects: [`Make the collection "${c.title}" public, with ${c.members.length} object(s), visible to anyone.`],
        expected: { [`collection:${c.id}`]: await sha256(canonicalJson({ title: c.title, members: [...c.members].sort((a, b) => a.position - b.position).map((m) => m.objectId) })) },
        targets: [c.id], resource: c.id,
        async apply() {
          const published: Collection = { ...c, kind: "published", visibility: "public" }
          world.register = { ...world.register, collections: world.register.collections.map((x) => (x.id === c.id ? published : x)) }
          const revisionId = await sha256(canonicalJson({ id: c.id, title: c.title, members: [...c.members].sort((a, b) => a.position - b.position) }))
          return { before: { [c.id]: c.visibility }, after: { [c.id]: "public" }, output: { collectionId: c.id, revisionId } }
        },
      } }
    }
  }
  return refuse("failed", "unsupported_capability", `${capability.id} is not performed by this application.`)
}

export function authorityFor(world: World, actor: Participant, origin?: string): "public" | "owner" {
  return authorize(ctxOf(world, actor, origin), { scopes: ["read:private"] }, "*").decision === "allow" ? "owner" : "public"
}

export function getPosition(world: World, actor: Participant, participantId?: string): WriteResult<Position | null> {
  if (participantId !== undefined && participantId !== actor.id) return stop("denied", "not_permitted", "A participant reads only their own position.")
  return { status: "ok", data: world.positions.positions[actor.id] ?? null }
}

const capabilityOf = (id: string) => CAPABILITIES.find((c) => c.id === id)

async function digestOf(request: OperationRequest, actor: string, principal: string, expected: Record<string, string>) {
  return sha256(canonicalJson({ capability: request.capability, version: request.version ?? capabilityOf(request.capability)?.version, arguments: request.arguments ?? {}, actor, principal, expected }))
}

const PREPARATION_TTL_MS = 15 * 60 * 1000
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()

interface Prepared { capability: Capability; args: Record<string, any>; plan: Plan; decision: Extract<Decision, { decision: "allow" }> }

async function check(world: World, actor: Participant, request: OperationRequest, origin?: string): Promise<Prepared | WriteResult<never>> {
  const capability = capabilityOf(request.capability)
  if (!capability || !WRITE_PERFORMED.has(capability.id)) return stop("failed", "unsupported_capability", `${request.capability} is not performed here.`, { capability: request.capability })
  if (request.version !== undefined && request.version !== capability.version) return stop("failed", "unsupported_version", `${capability.id} is at version ${capability.version}.`, { supported: [capability.version] })
  const problems = validate(capability.inputSchema, request.arguments ?? {})
  if (problems.length) return stop("failed", "invalid_arguments", problems.join("; "), { problems })
  const planned = await plan(world, capability, (request.arguments ?? {}) as Record<string, any>, actor)
  if ("error" in planned) return planned.error
  const decision = authorize(ctxOf(world, actor, origin), capability, planned.plan.resource)
  if (decision.decision === "denied") {
    record(world, "operation.denied", actor.id, { resourceIds: planned.plan.targets, payload: { capability: capability.id, reason: decision.reason } })
    return stop("denied", "not_permitted", decision.message, { reason: decision.reason })
  }
  return { capability, args: (request.arguments ?? {}) as Record<string, any>, plan: planned.plan, decision }
}

export async function perform(world: World, actor: Participant, request: OperationRequest, options: { idempotencyKey?: string; origin?: string; taskId?: string } = {}): Promise<WriteResult<unknown>> {
  const replay = await replayOf(world, actor, request, options.idempotencyKey)
  if (replay) return replay
  const checked = await check(world, actor, request, options.origin)
  if ("status" in checked) return checked
  const { capability, plan: p, decision } = checked

  if (needsApprovalFor(capability)) {
    const operationId = world.ids()
    const preparedAt = world.clock()
    const digest = await digestOf(request, actor.id, decision.principal, p.expected)
    const preparation: Preparation = { operationId, capability: capability.id, version: capability.version, arguments: request.arguments ?? {}, actor: actor.id, principal: decision.principal, effects: p.effects, expectedRevisions: p.expected, digest, preparedAt, expiresAt: later(preparedAt, PREPARATION_TTL_MS), ...(options.taskId ? { taskId: options.taskId } : {}) }
    world.preparations[operationId] = preparation
    world.operations[operationId] = { id: operationId, status: "awaiting_approval", capability: capability.id, actor: actor.id, principal: decision.principal, preparedAt }
    record(world, "operation.prepared", actor.id, { operationId, resourceIds: p.targets, ...(options.taskId ? { taskId: options.taskId } : {}), payload: { capability: capability.id, ...(await redact(request.arguments)), effects: p.effects } })
    return stop("needs_approval", "approval_required", `${capability.id} needs ${decision.principal}'s approval.`, { operationId, effects: p.effects, digest, expiresAt: preparation.expiresAt })
  }
  return execute(world, actor, request, checked, undefined, options)
}

async function execute(world: World, actor: Participant, request: OperationRequest, checked: Prepared, approval: Approval | undefined, options: { idempotencyKey?: string; taskId?: string; operationId?: string }): Promise<WriteResult<unknown>> {
  const { capability, plan: p, decision } = checked
  const operationId = options.operationId ?? world.ids()

  const slot = options.idempotencyKey === undefined ? undefined : slotOf(actor.id, capability.id, options.idempotencyKey)
  const digest = await requestDigest(request, actor.id)

  const preparedAt = world.operations[operationId]?.preparedAt ?? world.clock()
  world.operations[operationId] ??= { id: operationId, status: "failed", capability: capability.id, actor: actor.id, principal: decision.principal, preparedAt }
  let effect: Awaited<ReturnType<Plan["apply"]>>
  try {
    effect = await p.apply({ actor, principal: decision.principal })
  } catch (e) {
    world.operations[operationId].status = "failed"
    world.operations[operationId].settledAt = world.clock()
    record(world, "operation.failed", actor.id, { operationId, payload: { capability: capability.id } })
    return stop("failed", "unverified", `The operation failed: ${(e as Error).message}`, { operationId })
  }
  if (slot) world.idempotency[slot] = { digest, operationId }
  if (approval) approval.usedAt = world.clock()

  if (world.faults?.failReceiptWrite) {
    world.operations[operationId].status = "unknown"
    return stop("unknown", "unverified", "The change may have been applied, but its outcome could not be recorded or verified.", { operationId })
  }
  const receipt: Receipt = {
    id: world.ids(), operationId, capability: capability.id, version: capability.version, actor: actor.id, principal: decision.principal,
    authorization: { decision: "allow", ...(decision.grant ? { grant: decision.grant } : {}) }, ...(approval ? { approval: approval.id } : {}),
    before: effect.before, after: effect.after, outcome: "committed", at: world.clock(), ...(effect.output !== undefined ? { output: effect.output } : {}),
  }
  world.receipts[operationId] = receipt
  world.operations[operationId].status = "committed"
  world.operations[operationId].settledAt = receipt.at
  record(world, "operation.committed", actor.id, { operationId, resourceIds: p.targets, causationId: approval?.id, ...(options.taskId ? { taskId: options.taskId } : {}), payload: { capability: capability.id, receiptId: receipt.id, ...(await redact(request.arguments)) } })
  return { status: "ok", data: { receipt, replayed: false } }
}

export async function approve(world: World, approver: Participant, operationId: string): Promise<WriteResult<Approval>> {
  const prep = world.preparations[operationId]
  const op = world.operations[operationId]
  if (!prep || !op) return stop("failed", "not_found", `No prepared operation ${operationId}.`, { id: operationId })
  if (!mayApprove(approver, prep.principal)) {
    record(world, "approval.refused", approver.id, { operationId, payload: { reason: approver.kind !== "human" ? "not_human" : "not_principal" } })
    return stop("denied", "not_permitted", "Only the person this is done for can approve it, never an agent.")
  }
  if (op.status !== "awaiting_approval") return stop("failed", "invalid_state", `That operation is ${op.status}, not awaiting approval.`)
  const at = world.clock()
  if (prep.expiresAt <= at) return stop("failed", "approval_invalid", "That preparation has expired. Prepare it again.")
  const approval: Approval = { id: world.ids(), operationId, digest: prep.digest, approvedBy: approver.id, approvedAt: at, expiresAt: later(at, PREPARATION_TTL_MS) }
  world.approvals[approval.id] = approval
  record(world, "approval.granted", approver.id, { operationId, causationId: operationId, payload: { digest: prep.digest } })
  return { status: "ok", data: approval }
}

export async function commit(world: World, actor: Participant, request: OperationRequest, approvalId: string, options: { idempotencyKey?: string; origin?: string; taskId?: string } = {}): Promise<WriteResult<unknown>> {
  const replay = await replayOf(world, actor, request, options.idempotencyKey)
  if (replay) return replay
  const approval = world.approvals[approvalId]
  if (!approval) return stop("failed", "approval_invalid", "No such approval.")
  const prep = world.preparations[approval.operationId]
  const op = world.operations[approval.operationId]
  const refuseApproval = (why: string) => { record(world, "commit.refused", actor.id, { operationId: approval.operationId, payload: { why } }); return stop("denied", "approval_invalid", `The approval cannot be used: ${why}.`, { why }) }
  if (approval.usedAt) return refuseApproval("it has already been used")
  if (approval.expiresAt <= world.clock()) return refuseApproval("it has expired")
  if (op.status !== "awaiting_approval") return refuseApproval(`the operation is ${op.status}`)

  const checked = await check(world, actor, request, options.origin)
  if ("status" in checked) return checked
  const digest = await digestOf(request, actor.id, checked.decision.principal, checked.plan.expected)
  if (digest !== approval.digest || digest !== prep.digest) return refuseApproval("what is being committed is not what was approved")
  return execute(world, actor, request, checked, approval, { ...options, operationId: approval.operationId })
}

export function cancel(world: World, actor: Participant, operationId: string): WriteResult<OperationRecord> {
  const op = world.operations[operationId]
  if (!op) return stop("failed", "not_found", `No operation ${operationId}.`, { id: operationId })
  if (!(actor.id === op.actor || actor.id === op.principal || actor.id === world.owner)) return stop("denied", "not_permitted", "Only a party to an operation can cancel it.")
  if (op.status === "awaiting_approval") {
    op.status = "cancelled"
    op.settledAt = world.clock()
    record(world, "operation.cancelled", actor.id, { operationId, payload: {} })
    return { status: "cancelled", data: op }
  }
  return stop("failed", "too_late", `Too late to cancel: the operation is ${op.status}.`, { operationId, status: op.status, ...(world.receipts[operationId] ? { receiptId: world.receipts[operationId].id } : {}) })
}

export function getReceipt(world: World, actor: Participant, operationId: string): WriteResult<Receipt> {
  const r = world.receipts[operationId]
  if (!r || !(actor.id === r.actor || actor.id === r.principal || actor.id === world.owner)) return stop("failed", "not_found", `No receipt for ${operationId}.`, { id: operationId })
  return { status: "ok", data: r }
}

export function auditGaps(world: World): string[] {
  const gaps: string[] = []
  for (const op of Object.values(world.operations)) {
    if (op.status !== "committed") continue
    if (!world.receipts[op.id]) gaps.push(`${op.id}: committed with no receipt`)
    if (!world.events.some((e) => e.type === "operation.committed" && e.operationId === op.id)) gaps.push(`${op.id}: committed with no event`)
  }
  return gaps
}

export async function revalidate(world: World, actor: Participant, preparation: Preparation): Promise<{ code: ErrorCode; message: string }[]> {
  const out = await check(world, actor, { capability: preparation.capability, version: preparation.version, arguments: preparation.arguments })
  if ("status" in out) return "error" in out ? [{ code: out.error.code, message: out.error.message }] : []
  const digest = await digestOf({ capability: preparation.capability, version: preparation.version, arguments: preparation.arguments }, actor.id, out.decision.principal, out.plan.expected)
  return digest === preparation.digest ? [] : [{ code: "stale_revision", message: "What this relied on has changed since it was prepared." }]
}

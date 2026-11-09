import { approve, cancel, commit, newWorld, perform, type EventEnvelope, type OperationRecord, type World } from "../../core/src/operations.ts"
import type { OperationRequest } from "../../core/src/capabilities.ts"
import type { Participant } from "../../core/src/authority.ts"
import { appendRevision, type Collection, type Register, type SystemObject } from "../../core/src/core.ts"
import type { Store } from "./store.ts"

const ALPHABET = "abcdefghjkmnpqrstvwxyz23456789"
const randomIds = () => "ko-" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET[b % ALPHABET.length]).join("")

const SNAPSHOT = "world:snapshot"
const eventKey = (n: number) => `world:event:${String(n).padStart(8, "0")}`

interface Snapshot {
  version: 1
  owner: string
  eventCount: number
  grants: World["grants"]
  annotations: World["annotations"]
  proposals: World["proposals"]
  operations: World["operations"]
  preparations: World["preparations"]
  approvals: World["approvals"]
  receipts: World["receipts"]
  idempotency: World["idempotency"]
  tasks: World["tasks"]
  positions: World["positions"]
  collections: Collection[]
  localRevisions: SystemObject[]
  withdrawn: Register["withdrawn"]
}

export interface OpenedWorld {
  world: World
  save: (fault?: { stopAfterLog?: boolean }) => Promise<void>
  recovered: string[]
  stale: SystemObject[]
}

export async function openWorld(store: Store, base: Register, owner: string, options: { clock?: () => string; ids?: () => string } = {}): Promise<OpenedWorld> {
  const snapshot = await store.get<Snapshot>(SNAPSHOT)
  const world = newWorld(base, owner, { ...options, ids: options.ids ?? randomIds })
  const recovered: string[] = []
  const stale: SystemObject[] = []
  let saved = 0

  if (snapshot) {
    if (snapshot.owner !== owner) throw new Error(`This store belongs to ${snapshot.owner}, not ${owner}.`)
    world.grants = snapshot.grants
    world.annotations = snapshot.annotations
    world.proposals = snapshot.proposals
    world.operations = snapshot.operations
    world.preparations = snapshot.preparations
    world.approvals = snapshot.approvals
    world.receipts = snapshot.receipts
    world.idempotency = snapshot.idempotency
    world.tasks = snapshot.tasks
    world.positions = snapshot.positions
    world.register = { ...world.register, collections: [...base.collections.filter((c) => !snapshot.collections.some((s) => s.id === c.id)), ...snapshot.collections], withdrawn: { ...base.withdrawn, ...snapshot.withdrawn } }
    for (const revision of snapshot.localRevisions) {
      const current = world.register.objects.find((o) => o.id === revision.id)
      if (current && (current.revisionId === revision.previousRevisionId || current.revisionId === revision.revisionId)) world.register = appendRevision(world.register, revision)
      else if (!current) world.register = appendRevision(world.register, revision)
      else stale.push(revision)
    }
    saved = snapshot.eventCount
  }

  const keys = await store.keys("world:event:")
  const events: EventEnvelope[] = []
  for (const key of keys) events.push((await store.get<EventEnvelope>(key))!)
  world.events = events
  if (events.length > saved) {
    recovered.push(`${events.length - saved} event(s) are newer than the last snapshot: the process stopped between writing the log and the state.`)
    for (const event of events.slice(saved)) {
      if (event.type === "operation.committed" && event.operationId && !world.receipts[event.operationId]) {
        const op = world.operations[event.operationId] ?? ({ id: event.operationId, status: "unknown", capability: String(event.payload.capability ?? ""), actor: event.actorId, principal: "", preparedAt: event.occurredAt } as OperationRecord)
        op.status = "unknown"
        world.operations[event.operationId] = op
        recovered.push(`Operation ${event.operationId} is recorded as committed but has no receipt: its outcome is unknown.`)
      }
    }
  }

  let persisted = events.length
  const save = async (fault: { stopAfterLog?: boolean } = {}) => {
    for (let i = persisted; i < world.events.length; i++) await store.set(eventKey(i), world.events[i])
    persisted = world.events.length
    if (fault.stopAfterLog) return
    const local = world.register.collections.filter((c) => !baseCollectionUnchanged(base, c))
    const localRevisions = world.register.objects
      .filter((o) => base.objects.find((b) => b.id === o.id)?.revisionId !== o.revisionId)
      .flatMap((o) => lineage(world.register, base, o))
    const next: Snapshot = {
      version: 1, owner, eventCount: world.events.length,
      grants: world.grants, annotations: world.annotations, proposals: world.proposals, operations: world.operations, preparations: world.preparations,
      approvals: world.approvals, receipts: world.receipts, idempotency: world.idempotency, tasks: world.tasks, positions: world.positions,
      collections: local, localRevisions, withdrawn: world.register.withdrawn,
    }
    await store.set(SNAPSHOT, next)
  }
  return { world, save, recovered, stale }
}

const baseCollectionUnchanged = (base: Register, c: Collection) => JSON.stringify(base.collections.find((b) => b.id === c.id)) === JSON.stringify(c)

function lineage(register: Register, base: Register, object: SystemObject): SystemObject[] {
  const chain: SystemObject[] = []
  const seen = new Set<string>()
  for (let at: SystemObject | undefined = object; at && !seen.has(at.revisionId) && !(at.revisionId in base.revisions); at = at.previousRevisionId ? register.revisions[at.previousRevisionId] : undefined) {
    seen.add(at.revisionId)
    chain.unshift(at)
  }
  return chain
}

export function persisted(opened: OpenedWorld) {
  const w = opened.world
  const kept = async <T>(result: T): Promise<T> => { await opened.save(); return result }
  return {
    world: w,
    perform: async (actor: Participant, request: OperationRequest, options?: Parameters<typeof perform>[3]) => kept(await perform(w, actor, request, options)),
    approve: async (approver: Participant, operationId: string) => kept(await approve(w, approver, operationId)),
    commit: async (actor: Participant, request: OperationRequest, approvalId: string, options?: Parameters<typeof commit>[4]) => kept(await commit(w, actor, request, approvalId, options)),
    cancel: async (actor: Participant, operationId: string) => kept(cancel(w, actor, operationId)),
  }
}

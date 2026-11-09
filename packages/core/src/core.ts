export const SYSTEM_VERSION = "0.1.0"

export type Visibility = "public" | "unlisted" | "private"

export type Authority = "public" | "owner"

export interface Provenance {
  method: "authored" | "derived" | "inferred"
  recordedBy: string
  source?: string
}

export interface Representation {
  id: string
  objectId: string
  role: "page" | "record" | "media"
  mediaType: string
  href: string
  availability: "available" | "unavailable"
  language?: string
  integrity?: string
}

export interface SystemObject {
  schemaVersion: typeof SYSTEM_VERSION
  id: string
  type: string
  title: string
  date: string
  summary?: string
  visibility: Visibility
  canonicalUri: string
  revisionId: string
  previousRevisionId?: string
  sequence: number
  representations: Representation[]
  provenance: Provenance
  anchors?: string[]
}

export type RelationType =
  | "partOf" | "contains" | "follows" | "precedes" | "references" | "derivedFrom"
  | "relatedTo" | "depicts" | "locatedAt" | "supports" | "contradicts" | "revisionOf"

export interface Relation {
  type: RelationType
  from: string
  to: string
  provenance: Provenance
  via?: string
}

export interface Collection {
  schemaVersion: typeof SYSTEM_VERSION
  id: string
  kind: "thread" | "gathered" | "published"
  title: string
  visibility: Visibility
  orderKey: "position"
  members: { objectId: string; position: number; basis?: "authored" | "evidenced" | "inferred" }[]
  rationale?: string
  provenance: Provenance
}

export interface Register {
  scope: string
  objects: SystemObject[]
  relations: Relation[]
  collections: Collection[]
  revisions: Record<string, SystemObject>
  withdrawn: Record<string, { withdrawnAt: string; reason?: string }>
  claims?: import("./warrant.ts").Claim[]
  warrants?: import("./warrant.ts").Warrant[]
}

export type ErrorCode =
  | "not_found" | "withdrawn" | "revision_not_found"
  | "invalid_query" | "invalid_cursor"
  | "invalid_arguments" | "unsupported_capability" | "unsupported_version"
  | "approval_required" | "approval_invalid" | "not_permitted" | "stale_revision"
  | "idempotency_conflict" | "too_late" | "invalid_state" | "unverified"

export interface OperationError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

export type OperationResult<T> =
  | { status: "ok"; data: T }
  | { status: "failed"; error: OperationError }

const ok = <T>(data: T): OperationResult<T> => ({ status: "ok", data })
const fail = <T>(code: ErrorCode, message: string, details?: Record<string, unknown>): OperationResult<T> => ({
  status: "failed",
  error: { code, message, ...(details ? { details } : {}) },
})

export interface Ordering {
  id: string
  field: "date" | "title" | "sequence"
  direction: "asc" | "desc"
  missing: "last" | "first"
  tieBreak: "sequence"
  description: string
}

export const ORDERINGS: Record<string, Ordering> = {
  "date:desc": { id: "date:desc", field: "date", direction: "desc", missing: "last", tieBreak: "sequence", description: "Newest first; objects of the same date stay in the order they were authored." },
  "date:asc": { id: "date:asc", field: "date", direction: "asc", missing: "last", tieBreak: "sequence", description: "Oldest first; objects of the same date stay in the order they were authored." },
  "title:asc": { id: "title:asc", field: "title", direction: "asc", missing: "last", tieBreak: "sequence", description: "Alphabetical by title." },
  "title:desc": { id: "title:desc", field: "title", direction: "desc", missing: "last", tieBreak: "sequence", description: "Reverse alphabetical by title." },
  "sequence:asc": { id: "sequence:asc", field: "sequence", direction: "asc", missing: "last", tieBreak: "sequence", description: "In the order the register was authored." },
}

export const DEFAULT_ORDERING = "date:desc"
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export interface ObjectQuery {
  type?: string
  order?: string
  limit?: number
  cursor?: string
}

export interface Page<T> {
  items: T[]
  total: number
  ordering: Ordering
  nextCursor: string | null
}

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

export function sortBy(objects: SystemObject[], ordering: Ordering): SystemObject[] {
  const sign = ordering.direction === "asc" ? 1 : -1
  const valueOf = (o: SystemObject) => (ordering.field === "sequence" ? o.sequence : o[ordering.field])
  return [...objects].sort((a, b) => {
    const va = valueOf(a)
    const vb = valueOf(b)
    const aMissing = va === undefined || va === ""
    const bMissing = vb === undefined || vb === ""
    if (aMissing !== bMissing) return aMissing === (ordering.missing === "last") ? 1 : -1
    const primary = aMissing ? 0 : sign * compare(va as string | number, vb as string | number)
    return primary || compare(a.sequence, b.sequence) || compare(a.id, b.id)
  })
}

export const canRead = (o: SystemObject, authority: Authority) => authority === "owner" || o.visibility !== "private"
export const isListed = (o: SystemObject, authority: Authority) => authority === "owner" || o.visibility === "public"

const encodeCursor = (offset: number, query: string) => btoa(JSON.stringify({ o: offset, q: query })).replace(/=+$/, "")
function decodeCursor(cursor: string): { o: number; q: string } | null {
  try {
    const value = JSON.parse(atob(cursor))
    return Number.isInteger(value?.o) && value.o >= 0 && typeof value.q === "string" ? value : null
  } catch {
    return null
  }
}

export function listObjects(register: Register, query: ObjectQuery = {}, authority: Authority = "public"): OperationResult<Page<SystemObject>> {
  const orderId = query.order ?? DEFAULT_ORDERING
  const ordering = ORDERINGS[orderId]
  if (!ordering) return fail("invalid_query", `Unknown ordering "${orderId}".`, { orderings: Object.keys(ORDERINGS) })
  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return fail("invalid_query", `limit must be a whole number from 1 to ${MAX_LIMIT}.`)
  }
  const signature = JSON.stringify([query.type ?? null, orderId, limit])
  let offset = 0
  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor)
    if (!decoded) return fail("invalid_cursor", "The cursor is not one this register issued.")
    if (decoded.q !== signature) return fail("invalid_cursor", "The cursor belongs to a different query.")
    offset = decoded.o
  }
  const matching = register.objects.filter((o) => isListed(o, authority) && !(o.id in register.withdrawn) && (query.type === undefined || o.type === query.type))
  const sorted = sortBy(matching, ordering)
  const items = sorted.slice(offset, offset + limit)
  const next = offset + limit
  return ok({ items, total: sorted.length, ordering, nextCursor: next < sorted.length ? encodeCursor(next, signature) : null })
}

export function typesIn(register: Register, authority: Authority = "public"): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const o of register.objects) {
    if (!isListed(o, authority) || o.id in register.withdrawn) continue
    counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
  }
  return [...counts].map(([type, count]) => ({ type, count }))
}

export function readObject(register: Register, id: string, options: { revisionId?: string; authority?: Authority } = {}): OperationResult<SystemObject> {
  const authority = options.authority ?? "public"
  if (id in register.withdrawn) return fail("withdrawn", `The object ${id} has been withdrawn.`, { id, ...register.withdrawn[id] })
  const current = register.objects.find((o) => o.id === id)
  if (!current || !canRead(current, authority)) return fail("not_found", `No object ${id}.`, { id })
  if (options.revisionId === undefined || options.revisionId === current.revisionId) return ok(current)
  const past = register.revisions[options.revisionId]
  if (!past || past.id !== id) return fail("revision_not_found", `Object ${id} has no revision ${options.revisionId}.`, { id, revisionId: options.revisionId })
  return ok(past)
}

export function listRevisions(register: Register, id: string, authority: Authority = "public"): OperationResult<SystemObject[]> {
  const current = readObject(register, id, { authority })
  if (current.status === "failed") return current
  const chain: SystemObject[] = []
  const seen = new Set<string>()
  for (let at: SystemObject | undefined = current.data; at && !seen.has(at.revisionId); at = at.previousRevisionId ? register.revisions[at.previousRevisionId] : undefined) {
    seen.add(at.revisionId)
    chain.push(at)
  }
  return ok(chain)
}

export function listRelations(register: Register, id: string, options: { type?: RelationType; authority?: Authority } = {}): OperationResult<Relation[]> {
  const authority = options.authority ?? "public"
  const found = readObject(register, id, { authority })
  if (found.status === "failed") return found
  const visible = (other: string) => {
    const o = register.objects.find((x) => x.id === other)
    return !!o && canRead(o, authority) && !(other in register.withdrawn)
  }
  return ok(
    register.relations.filter(
      (r) => (r.from === id || r.to === id) && (options.type === undefined || r.type === options.type) && visible(r.from === id ? r.to : r.from),
    ),
  )
}

export const WITHHELD = "(withheld)"

export interface CollectionMember {
  objectId: string
  position: number
  state: "available" | "withdrawn" | "missing"
}

export function readCollection(register: Register, id: string, authority: Authority = "public"): OperationResult<{ collection: Collection; members: CollectionMember[] }> {
  const collection = register.collections.find((c) => c.id === id)
  if (!collection || (collection.visibility === "private" && authority !== "owner")) return fail("not_found", `No collection ${id}.`, { id })
  const members = [...collection.members]
    .sort((a, b) => compare(a.position, b.position) || compare(a.objectId, b.objectId))
    .map(({ objectId, position }): CollectionMember => {
      if (objectId in register.withdrawn) return { objectId, position, state: "withdrawn" }
      const o = register.objects.find((x) => x.id === objectId)
      if (!o) return { objectId, position, state: "missing" }
      return canRead(o, authority) ? { objectId, position, state: "available" } : { objectId: WITHHELD, position, state: "missing" }
    })
  const basis = new Map(collection.members.map((m) => [m.objectId, m.basis]))
  const shown = { ...collection, members: members.map(({ objectId, position }) => ({ objectId, position, ...(basis.get(objectId) ? { basis: basis.get(objectId) } : {}) })) }
  return ok({ collection: shown, members })
}

export function appendRevision(register: Register, next: SystemObject): Register {
  const current = register.objects.find((o) => o.id === next.id)
  const revisions = { ...register.revisions, [next.revisionId]: next }
  if (current && !(current.revisionId in revisions)) revisions[current.revisionId] = current
  return {
    ...register,
    revisions,
    objects: current ? register.objects.map((o) => (o.id === next.id ? next : o)) : [...register.objects, next],
  }
}

export function withdraw(register: Register, id: string, info: { withdrawnAt: string; reason?: string }): Register {
  return { ...register, withdrawn: { ...register.withdrawn, [id]: info } }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compare(a, b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function revisionContent(o: SystemObject): string {
  const { revisionId: _revisionId, sequence: _sequence, ...content } = o
  return canonicalJson(content)
}

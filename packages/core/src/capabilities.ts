import { readWarrant } from "./warrant.ts"
import {
  listObjects, listRelations, listRevisions, readCollection, readObject, canRead, isListed, sortBy, ORDERINGS, DEFAULT_LIMIT, MAX_LIMIT,
  type Authority, type ErrorCode, type OperationResult, type Page, type Register, type SystemObject,
} from "./core.ts"

export interface Schema {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array"
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  enum?: (string | number)[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  items?: Schema
  minItems?: number
  maxItems?: number
  minProperties?: number
  description?: string
}

export function validate(schema: Schema, value: unknown, path = "arguments"): string[] {
  const errors: string[] = []
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : typeof value
  if (schema.type) {
    const ok = schema.type === "integer" ? Number.isInteger(value) : schema.type === "number" ? typeof value === "number" && Number.isFinite(value) : kind === schema.type
    if (!ok) return [`${path} must be ${schema.type}`]
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`)
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must have at least ${schema.minLength} characters`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} must have at most ${schema.maxLength} characters`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} is not in the expected form`)
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`)
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)))
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${path}.${key} is required`)
    if (schema.minProperties !== undefined && Object.keys(object).length < schema.minProperties) errors.push(`${path} must have at least ${schema.minProperties} properties`)
    for (const [key, v] of Object.entries(object)) {
      const sub = schema.properties?.[key]
      if (sub) errors.push(...validate(sub, v, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known argument`)
    }
  }
  return errors
}

export type Effect = "read" | "ephemeral" | "persistent_reversible" | "persistent_limited" | "irreversible" | "non_public" | "consequential"

export interface Capability {
  id: string
  version: number
  name: string
  description: string
  effect: Effect
  scopes: string[]
  confirmation: "none" | "required"
  idempotent: boolean
  cancellable: boolean
  audit: "none" | "required"
  inputSchema: Schema
  errors: ErrorCode[]
  implemented: boolean
}

type Shared = Omit<Capability, "id" | "name" | "description" | "inputSchema" | "errors" | "implemented">
const READ: Shared = { effect: "read", scopes: ["read:public"], confirmation: "none", idempotent: true, cancellable: false, audit: "none", version: 1 }
const ID: Schema = { type: "string", minLength: 1, maxLength: 200 }
const PAGING: Record<string, Schema> = {
  limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Page size, ${DEFAULT_LIMIT} by default.` },
  cursor: { type: "string", maxLength: 500, description: "From a previous page's nextCursor." },
}
const UNBUILT: Pick<Capability, "version" | "confirmation" | "idempotent" | "cancellable" | "audit" | "errors" | "implemented"> = { version: 1, confirmation: "none", idempotent: true, cancellable: false, audit: "none", errors: [], implemented: false }

export const CAPABILITIES: Capability[] = [
  {
    ...READ, id: "ko_search_objects", name: "Search the register",
    description: "Find objects whose title or summary matches words. Each result says how it matched: exactly (the title is the query) or lexically (every word appears). No relevance score is given.",
    inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 }, type: { type: "string", maxLength: 60, description: "Only this kind of object." }, ...PAGING } },
    errors: ["invalid_arguments", "invalid_cursor"], implemented: true,
  },
  {
    ...READ, id: "ko_read_object", name: "Read an object",
    description: "One object with its representations, or the reason it cannot be given (not found, withdrawn, no such revision).",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID, revisionId: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } } },
    errors: ["invalid_arguments", "not_found", "withdrawn", "revision_not_found"], implemented: true,
  },
  {
    ...READ, id: "ko_list_relations", name: "List an object's relations",
    description: "Typed relations touching an object, each with whether it was authored, derived or inferred.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID, type: { type: "string", enum: ["partOf", "contains", "follows", "precedes", "references", "derivedFrom", "relatedTo", "depicts", "locatedAt", "supports", "contradicts", "revisionOf"] } } },
    errors: ["invalid_arguments", "not_found", "withdrawn"], implemented: true,
  },
  {
    ...READ, id: "ko_read_thread", name: "Read a thread",
    description: "A thread's members in the order its author gave them, with why they belong together. A member that has gone is reported, not dropped.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID } },
    errors: ["invalid_arguments", "not_found"], implemented: true,
  },
  {
    ...READ, id: "ko_compare_revisions", name: "Compare two revisions",
    description: "What changed between two revisions of one object, field by field.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id", "from", "to"], properties: { id: ID, from: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, to: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } } },
    errors: ["invalid_arguments", "not_found", "revision_not_found"], implemented: true,
  },
  {
    ...READ, id: "ko_get_warrant", name: "Get the evidence for a claim",
    description: "A claim, what it rests on, where each source resolves today, and whether the evidence supports the status the warrant declares. There is no confidence number.",
    inputSchema: { type: "object", additionalProperties: false, required: ["claimId"], properties: { claimId: ID } },
    errors: ["invalid_arguments", "not_found"], implemented: true,
  },
  { ...UNBUILT, id: "ko_get_position", name: "Get a participant's position", description: "Where a participant is.", effect: "read", scopes: ["read:public"], inputSchema: { type: "object", additionalProperties: false, properties: { participantId: ID } } },
  { ...UNBUILT, id: "ko_set_position", name: "Move a participant's own position", description: "Moves the caller's own position, never another's.", effect: "ephemeral", scopes: ["position:own"], inputSchema: { type: "object", additionalProperties: false, required: ["position"], properties: { participantId: ID, position: { type: "object", additionalProperties: false, required: ["surfaceId"], properties: { surfaceId: ID, anchor: ID, offset: { type: "integer", minimum: 0 } } } } } },
  { ...UNBUILT, id: "ko_create_collection", name: "Create a private collection", description: "A new private gather.", effect: "persistent_reversible", scopes: ["collection:write"], inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 120 } } } },
  { ...UNBUILT, id: "ko_add_to_collection", name: "Add objects to a collection", description: "Adds references to a collection.", effect: "persistent_reversible", scopes: ["collection:write"], inputSchema: { type: "object", additionalProperties: false, required: ["id", "objectIds"], properties: { id: ID, objectIds: { type: "array", minItems: 1, maxItems: 100, items: ID }, basis: { type: "string", enum: ["authored", "evidenced", "inferred"] } } } },
  { ...UNBUILT, id: "ko_reorder_collection", name: "Reorder a collection", description: "Changes the order of a collection.", effect: "persistent_reversible", scopes: ["collection:write"], inputSchema: { type: "object", additionalProperties: false, required: ["id", "objectId", "position"], properties: { id: ID, objectId: ID, position: { type: "integer", minimum: 0 } } } },
  { ...UNBUILT, id: "ko_create_annotation", name: "Write an annotation", description: "Attaches an observation to a target.", effect: "persistent_reversible", scopes: ["annotation:write"], inputSchema: { type: "object", additionalProperties: false, required: ["objectId", "body"], properties: { objectId: ID, revisionId: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, body: { type: "string", minLength: 1, maxLength: 2000 } } } },
  { ...UNBUILT, id: "ko_preview_change", name: "Stage a proposed change", description: "Shows exactly what a change would do.", effect: "non_public", scopes: ["revise"], inputSchema: { type: "object", additionalProperties: false, required: ["id", "expectedRevision", "changes"], properties: { id: ID, expectedRevision: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, changes: { type: "object", additionalProperties: false, minProperties: 1, properties: { title: { type: "string", minLength: 1, maxLength: 300 }, summary: { type: "string", maxLength: 1000 }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } } } } },
  { ...UNBUILT, id: "ko_commit_change", name: "Commit an authorised revision", description: "Applies an approved change.", effect: "consequential", scopes: ["revise"], confirmation: "required", audit: "required", idempotent: false, inputSchema: { type: "object", additionalProperties: false, required: ["proposalId"], properties: { proposalId: ID } } },
  { ...UNBUILT, id: "ko_publish_collection", name: "Publish a collection", description: "Makes a collection public.", effect: "consequential", scopes: ["publish"], confirmation: "required", audit: "required", idempotent: false, inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID } } },
  { ...UNBUILT, id: "ko_get_receipt", name: "Inspect an operation's outcome", description: "The receipt for a consequential operation.", effect: "read", scopes: ["read:public"], inputSchema: { type: "object", additionalProperties: false, required: ["operationId"], properties: { operationId: ID } } },
]

export interface Described {
  executable: Capability[]
  unavailable: { capability: Capability; reason: string }[]
}

export function describeCapabilities(): Described {
  return {
    executable: CAPABILITIES.filter((c) => c.implemented),
    unavailable: CAPABILITIES.filter((c) => !c.implemented).map((capability) => ({ capability, reason: "Not implemented in this application." })),
  }
}

export const needsApprovalFor = (c: Pick<Capability, "confirmation" | "effect">) =>
  c.confirmation === "required" || c.effect === "consequential" || c.effect === "irreversible"

export interface OperationRequest {
  requestId?: string
  capability: string
  version?: number
  arguments?: unknown
}

const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): OperationResult<never> => ({ status: "failed", error: { code, message, ...(details ? { details } : {}) } })

export function invoke(register: Register, request: OperationRequest, authority: Authority = "public"): OperationResult<unknown> {
  const capability = CAPABILITIES.find((c) => c.id === request.capability)
  if (!capability) return fail("unsupported_capability", `No capability named ${request.capability}.`, { capability: request.capability })
  if (!capability.implemented) return fail("unsupported_capability", `${capability.id} is not implemented in this application.`, { capability: capability.id })
  if (request.version !== undefined && request.version !== capability.version) {
    return fail("unsupported_version", `${capability.id} is at version ${capability.version}; version ${request.version} is not supported.`, { supported: [capability.version] })
  }
  const args = request.arguments ?? {}
  const problems = validate(capability.inputSchema, args)
  if (problems.length) return fail("invalid_arguments", problems.join("; "), { problems })
  const a = args as Record<string, string | number | undefined>
  switch (capability.id) {
    case "ko_search_objects":
      return searchObjects(register, { query: a.query as string, type: a.type as string | undefined, limit: a.limit as number | undefined, cursor: a.cursor as string | undefined }, authority)
    case "ko_read_object":
      return readObject(register, a.id as string, { revisionId: a.revisionId as string | undefined, authority })
    case "ko_list_relations":
      return listRelations(register, a.id as string, { type: a.type as never, authority })
    case "ko_read_thread":
      return readCollection(register, a.id as string, authority)
    case "ko_get_warrant": {
      const reading = readWarrant(register, a.claimId as string)
      return reading ? { status: "ok", data: reading } : fail("not_found", `No claim ${a.claimId} with a warrant.`, { id: a.claimId })
    }
    case "ko_compare_revisions":
      return compareRevisions(register, a.id as string, a.from as string, a.to as string, authority)
    default:
      return fail("unsupported_capability", `${capability.id} has no implementation.`)
  }
}

export const fold = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase()

const words = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean)

export interface SearchHit {
  object: SystemObject
  match: "exact" | "lexical"
  matchedIn: ("title" | "summary")[]
}

export interface SearchPage extends Omit<Page<SearchHit>, "ordering"> {
  methods: ("exact" | "lexical")[]
  ordering: string
}

export function searchObjects(register: Register, q: { query: string; type?: string; limit?: number; cursor?: string }, authority: Authority = "public"): OperationResult<SearchPage> {
  const limit = q.limit ?? DEFAULT_LIMIT
  const signature = JSON.stringify(["search", q.query, q.type ?? null, limit])
  let offset = 0
  if (q.cursor !== undefined) {
    try {
      const c = JSON.parse(atob(q.cursor))
      if (c.q !== signature || !Number.isInteger(c.o) || c.o < 0) throw new Error()
      offset = c.o
    } catch {
      return fail("invalid_cursor", "The cursor is not one this search issued.")
    }
  }
  const wanted = words(q.query)
  const exact = fold(q.query).trim()
  const hits: SearchHit[] = []
  for (const object of sortBy(register.objects, ORDERINGS["date:desc"])) {
    if (!isListed(object, authority) || object.id in register.withdrawn || (q.type !== undefined && object.type.toLowerCase() !== q.type.toLowerCase())) continue
    const title = words(object.title)
    const summary = words(object.summary ?? "")
    const inTitle = wanted.every((w) => title.includes(w))
    const inEither = wanted.every((w) => title.includes(w) || summary.includes(w))
    if (!inEither) continue
    hits.push({
      object,
      match: fold(object.title).trim() === exact ? "exact" : "lexical",
      matchedIn: [...(wanted.some((w) => title.includes(w)) ? ["title" as const] : []), ...(wanted.some((w) => summary.includes(w)) && !inTitle ? ["summary" as const] : [])],
    })
  }
  hits.sort((a, b) => Number(b.match === "exact") - Number(a.match === "exact"))
  const items = hits.slice(offset, offset + limit)
  const next = offset + limit
  return {
    status: "ok",
    data: { items, total: hits.length, methods: ["exact", "lexical"], ordering: "exact matches first, then date:desc", nextCursor: next < hits.length ? btoa(JSON.stringify({ o: next, q: signature })).replace(/=+$/, "") : null },
  }
}

const COMPARED = ["type", "title", "date", "summary", "visibility", "canonicalUri"] as const

export function compareRevisions(register: Register, id: string, from: string, to: string, authority: Authority = "public"): OperationResult<{ id: string; from: string; to: string; changes: { field: string; before: unknown; after: unknown }[] }> {
  const a = readObject(register, id, { revisionId: from, authority })
  if (a.status === "failed") return a
  const b = readObject(register, id, { revisionId: to, authority })
  if (b.status === "failed") return b
  const changes = COMPARED.filter((f) => a.data[f] !== b.data[f]).map((field) => ({ field, before: a.data[field], after: b.data[field] }))
  return { status: "ok", data: { id, from, to, changes } }
}

export { listObjects, listRevisions, canRead }

import type { World } from "../../../core/src/operations.ts"

export interface RenderedChange {
  files: { path: string; content: string }[]
  subject: string
  body: string
  trailers: string[]
}

export function pretty(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)])) : v
  return JSON.stringify(sort(value), null, 2) + "\n"
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{3,60}$/
const SAFE_REVISION = /^sha256:[0-9a-f]{64}$/
const safeId = (id: string) => { if (!SAFE_ID.test(id)) throw new Error(`Refusing to write a file for the id "${id}".`); return id }

export function renderChange(world: World, operationId: string): RenderedChange {
  const receipt = world.receipts[operationId]
  if (!receipt) throw new Error(`No receipt for ${operationId}: nothing was committed there.`)
  const trailers = [
    `KO-Operation: ${receipt.operationId}`, `KO-Receipt: ${receipt.id}`, `KO-Capability: ${receipt.capability}`,
    `KO-Principal: ${receipt.principal}`, `KO-Actor: ${receipt.actor}`, ...(receipt.approval ? [`KO-Approval: ${receipt.approval}`] : []),
  ]
  if (receipt.capability === "ko_commit_change") {
    const [objectId] = Object.keys(receipt.after)
    const revisionId = receipt.after[objectId]!
    if (!SAFE_REVISION.test(revisionId)) throw new Error(`Refusing to write a file for the revision "${revisionId}".`)
    const object = world.register.revisions[revisionId]
    if (!object || object.id !== objectId) throw new Error(`Revision ${revisionId} of ${objectId} is not in this world.`)
    const before = receipt.before[objectId]
    return {
      files: [
        { path: `content/objects/${safeId(objectId)}.json`, content: pretty(object) },
        { path: `content/revisions/${revisionId.replace(":", "-")}.json`, content: pretty(object) },
      ],
      subject: `Revise ${object.title}`,
      body: `Object ${objectId}\n${before ?? "none"} -> ${revisionId}\nProvenance: ${object.provenance.method} by ${object.provenance.recordedBy}`,
      trailers: [...trailers, `KO-Revision: ${before ?? "none"} -> ${revisionId}`],
    }
  }
  if (receipt.capability === "ko_publish_collection") {
    const [collectionId] = Object.keys(receipt.after)
    const collection = world.register.collections.find((c) => c.id === collectionId)
    if (!collection || collection.visibility !== "public") throw new Error(`Collection ${collectionId} is not public in this world.`)
    return {
      files: [{ path: `content/collections/${safeId(collectionId)}.json`, content: pretty(collection) }],
      subject: `Publish ${collection.title}`,
      body: `Collection ${collectionId} with ${collection.members.length} object(s), made public.`,
      trailers: [...trailers, ...(receipt.output && typeof receipt.output === "object" && "revisionId" in receipt.output ? [`KO-Revision: ${(receipt.output as { revisionId: string }).revisionId}`] : [])],
    }
  }
  throw new Error(`${receipt.capability} is private state, not published content: it is never written to the repository.`)
}


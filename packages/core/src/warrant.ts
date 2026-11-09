import { restorePosition } from "./position.ts"
import type { Provenance, Register } from "./core.ts"

export type WarrantStatus = "supported" | "contested" | "incomplete" | "unverified"

export interface Claim {
  id: string
  statement: string
  subject: string
  revisionId: string
  author: Provenance
}

export interface WarrantSource {
  objectId: string
  revisionId: string
  anchor?: string
  relation: "supports" | "contradicts"
}

export interface Warrant {
  claimId: string
  sources: WarrantSource[]
  method: string
  author: Provenance
  revisionId: string
  limitations: string[]
  status: WarrantStatus
}

export type SourceState = "resolved" | "anchor_nearby" | "anchor_missing" | "revision_missing" | "object_missing" | "withdrawn"

export interface ResolvedSource extends WarrantSource {
  state: SourceState
  foundAt?: string
}

export function resolveSources(register: Register, warrant: Warrant): ResolvedSource[] {
  return warrant.sources.map((source): ResolvedSource => {
    if (source.objectId in register.withdrawn) return { ...source, state: "withdrawn" }
    const current = register.objects.find((o) => o.id === source.objectId)
    if (!current) return { ...source, state: "object_missing" }
    const revision = current.revisionId === source.revisionId ? current : register.revisions[source.revisionId]
    if (!revision || revision.id !== source.objectId) return { ...source, state: "revision_missing" }
    if (source.anchor === undefined) return { ...source, state: "resolved" }
    const at = restorePosition({ surfaceId: source.objectId, anchor: source.anchor }, { surfaceId: source.objectId, revisionId: revision.revisionId, anchors: revision.anchors ?? [] })
    return at.resolution === "exact" ? { ...source, state: "resolved" } : { ...source, state: "anchor_missing" }
  })
}

export function statusFrom(sources: ResolvedSource[]): WarrantStatus {
  if (sources.length === 0) return "unverified"
  const reachable = (s: ResolvedSource) => s.state === "resolved"
  if (!sources.every(reachable)) return "incomplete"
  if (sources.some((s) => s.relation === "contradicts")) return "contested"
  return sources.some((s) => s.relation === "supports") ? "supported" : "unverified"
}

const ASSERTS: Record<WarrantStatus, number> = { unverified: 0, incomplete: 1, contested: 2, supported: 3 }

export interface WarrantReading {
  claim: Claim
  warrant: Warrant
  sources: ResolvedSource[]
  declared: WarrantStatus
  computed: WarrantStatus
  honest: boolean
}

export function readWarrant(register: Register, claimId: string): WarrantReading | null {
  const claim = register.claims?.find((c) => c.id === claimId)
  const warrant = register.warrants?.find((w) => w.claimId === claimId)
  if (!claim || !warrant) return null
  const sources = resolveSources(register, warrant)
  const computed = statusFrom(sources)
  return { claim, warrant, sources, declared: warrant.status, computed, honest: ASSERTS[warrant.status] <= ASSERTS[computed] }
}

export const hasFabricatedConfidence = (warrant: object) => ["confidence", "probability", "score", "certainty", "likelihood"].some((k) => k in warrant)

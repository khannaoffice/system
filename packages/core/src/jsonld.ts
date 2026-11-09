import type { Relation, SystemObject } from "./core.ts"

const SCHEMA_TYPE: Record<string, string> = {
  Writing: "Article",
  Photograph: "Photograph",
  Video: "VideoObject",
  Event: "Event",
  Project: "CreativeWork",
  Identity: "CreativeWork",
  Poster: "CreativeWork",
  System: "CreativeWork",
}

const RELATION_TERM: Record<string, string> = {
  partOf: "isPartOf",
  contains: "hasPart",
  relatedTo: "ko:relatedTo",
  derivedFrom: "isBasedOn",
  references: "citation",
  follows: "ko:follows",
  precedes: "ko:precedes",
  depicts: "ko:depicts",
  locatedAt: "ko:locatedAt",
  supports: "ko:supports",
  contradicts: "ko:contradicts",
  revisionOf: "ko:revisionOf",
}

export const CONTEXT = ["https://schema.org", { ko: "urn:khannaoffice:system:v1#" }]

export function toJsonLd(object: SystemObject, relations: Relation[] = [], base = ""): Record<string, unknown> {
  const idOf = (id: string) => `${base}/api/v1/objects/${id}`
  const related: Record<string, string[]> = {}
  for (const r of relations) {
    if (r.from !== object.id) continue
    const term = RELATION_TERM[r.type]
    related[term] = [...(related[term] ?? []), idOf(r.to)]
  }
  const startKey = object.type === "Event" ? "startDate" : "datePublished"
  return {
    "@context": CONTEXT,
    "@type": SCHEMA_TYPE[object.type] ?? "CreativeWork",
    "@id": idOf(object.id),
    url: object.canonicalUri,
    name: object.title,
    [startKey]: object.date,
    ...(object.summary ? { description: object.summary } : {}),
    additionalType: `ko:${object.type}`,
    "ko:revisionId": object.revisionId,
    "ko:provenance": object.provenance.method,
    encoding: object.representations.map((r) => ({ "@type": "MediaObject", contentUrl: r.href, encodingFormat: r.mediaType })),
    ...Object.fromEntries(Object.entries(related).map(([term, ids]) => [term, ids.map((id) => ({ "@id": id }))])),
  }
}

import type { Annotation } from "./operations.ts"
import type { Authority, Register } from "./core.ts"

export const ANNOTATION_CONTEXT = "http://www.w3.org/ns/anno.jsonld"

export type Target =
  | { kind: "object" }
  | { kind: "revision" }
  | { kind: "anchor"; anchor: string }
  | { kind: "text"; anchor: string; start: number; end: number; exact?: string }
  | { kind: "region"; x: number; y: number; w: number; h: number; unit?: "pixel" | "percent" }
  | { kind: "time"; start: number; end?: number }
  | { kind: "sequence"; member: string }
  | { kind: "place"; lat: number; lon: number }

const FRAGMENT_HTML = "http://www.w3.org/TR/html/"
const FRAGMENT_MEDIA = "http://www.w3.org/TR/media-frags/"

export function selectorFor(target: Target): Record<string, unknown> | null {
  switch (target.kind) {
    case "anchor": return { type: "FragmentSelector", conformsTo: FRAGMENT_HTML, value: target.anchor }
    case "text": return { type: "TextPositionSelector", start: target.start, end: target.end, ...(target.exact ? { refinedBy: { type: "TextQuoteSelector", exact: target.exact } } : {}) }
    case "region": return { type: "FragmentSelector", conformsTo: FRAGMENT_MEDIA, value: `xywh=${target.unit ?? "pixel"}:${target.x},${target.y},${target.w},${target.h}` }
    case "time": return { type: "FragmentSelector", conformsTo: FRAGMENT_MEDIA, value: `t=${target.start}${target.end !== undefined ? `,${target.end}` : ""}` }
    case "sequence": return { type: "FragmentSelector", conformsTo: FRAGMENT_HTML, value: target.member }
    case "place": return { type: "FragmentSelector", conformsTo: "http://tools.ietf.org/rfc/rfc5870", value: `geo:${target.lat},${target.lon}` }
    default: return null
  }
}

export function toWebAnnotation(annotation: Annotation, register: Register, authority: Authority, target: Target = { kind: "object" }, base = ""): Record<string, unknown> | null {
  if (annotation.visibility === "private" && authority !== "owner") return null
  const object = register.objects.find((o) => o.id === annotation.objectId)
  if (!object) return null
  const selector = selectorFor(target)
  return {
    "@context": ANNOTATION_CONTEXT,
    id: `${base}/annotations/${annotation.id}`,
    type: "Annotation",
    created: annotation.createdAt,
    creator: {
      id: `urn:khannaoffice:participant:${annotation.author}`,
      type: annotation.origin === "person" ? "Person" : annotation.origin === "agent" ? "Software" : "Software",
    },
    ...(annotation.origin !== "person" ? { "ko:onBehalfOf": `urn:khannaoffice:participant:${annotation.principal}` } : {}),
    "ko:origin": annotation.origin,
    body: { type: "TextualBody", value: annotation.body, format: "text/plain" },
    target: {
      source: object.canonicalUri,
      "ko:revisionId": annotation.revisionId,
      ...(selector ? { selector } : {}),
    },
  }
}

export function toAnnotationCollection(annotations: Annotation[], register: Register, authority: Authority, base = "") {
  const items = annotations.map((a) => toWebAnnotation(a, register, authority, { kind: "object" }, base)).filter((a): a is Record<string, unknown> => a !== null)
  return { "@context": ANNOTATION_CONTEXT, id: `${base}/annotations`, type: "AnnotationCollection", total: items.length, items }
}

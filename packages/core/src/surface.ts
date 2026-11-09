import { restorePosition, type Position } from "./position.ts"

export type Surface =
  | { type: "document"; id: string; anchors: string[] }
  | { type: "index"; id: string; anchors: string[]; label?: string }
  | { type: "sequence"; id: string; members: string[] }
  | { type: "time"; id: string; duration: number; chapters?: { id: string; start: number; title?: string }[] }
  | { type: "image"; id: string; width: number; height: number }
  | { type: "map"; id: string; bounds: { south: number; west: number; north: number; east: number }; minZoom: number; maxZoom: number }

export type Landing =
  | { resolution: "exact"; position: Position }
  | { resolution: "nearby"; position: Position; requested: string; reason: string }
  | { resolution: "fallback"; position: Position; requested: string; reason: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const view = (p: Position) => (p.viewState ?? {}) as Record<string, number | string | boolean>
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export function locate(surface: Surface, saved: Position): Landing {
  const at = (changes: Partial<Position>): Position => ({ ...saved, surfaceId: surface.id, ...changes })
  if (saved.surfaceId !== surface.id) return { resolution: "fallback", position: at({ anchor: undefined, offset: undefined, viewState: undefined }), requested: saved.surfaceId, reason: "this is a different surface" }

  switch (surface.type) {
    case "document":
    case "index": {
      const r = restorePosition(saved, { surfaceId: surface.id, revisionId: saved.revisionId, anchors: surface.anchors })
      if (r.resolution === "exact") return { resolution: "exact", position: at({}) }
      if (r.resolution === "nearby") return { resolution: "nearby", position: at({ anchor: r.anchor }), requested: r.requested, reason: "the anchor is gone; this is the nearest that remains" }
      return { resolution: "fallback", position: at({ anchor: undefined }), requested: r.requested ?? "", reason: "the anchor is gone and nothing near it remains" }
    }

    case "sequence": {
      const requested = saved.anchor ?? ""
      const index = surface.members.indexOf(requested)
      if (requested === "" ) return { resolution: "exact", position: at({}) }
      if (index >= 0) return { resolution: "exact", position: at({ offset: index }) }
      const hint = num(saved.offset)
      if (hint !== null && surface.members.length > 0) {
        const i = clamp(Math.round(hint), 0, surface.members.length - 1)
        return { resolution: "nearby", position: at({ anchor: surface.members[i], offset: i }), requested, reason: "that member is no longer in the sequence; this is the one now at its place" }
      }
      return { resolution: "fallback", position: at({ anchor: surface.members[0], offset: 0 }), requested, reason: "that member is no longer in the sequence" }
    }

    case "time": {
      const chapters = [...(surface.chapters ?? [])].sort((a, b) => a.start - b.start)
      const offset = num(saved.offset)
      if (saved.anchor !== undefined) {
        const chapter = chapters.find((c) => c.id === saved.anchor)
        if (chapter) return { resolution: "exact", position: at({ axis: "time", offset: chapter.start }) }
        if (offset !== null) {
          const t = clamp(offset, 0, surface.duration)
          return { resolution: "nearby", position: at({ axis: "time", anchor: undefined, offset: t }), requested: saved.anchor, reason: "that chapter is gone; this is the time it was at" }
        }
        return { resolution: "fallback", position: at({ axis: "time", anchor: undefined, offset: 0 }), requested: saved.anchor, reason: "that chapter is gone" }
      }
      if (offset === null) return { resolution: "exact", position: at({ axis: "time", offset: 0 }) }
      if (offset >= 0 && offset <= surface.duration) return { resolution: "exact", position: at({ axis: "time", offset }) }
      const t = clamp(offset, 0, surface.duration)
      return { resolution: "fallback", position: at({ axis: "time", offset: t }), requested: `${offset}s`, reason: offset > surface.duration ? "that is past the end of the film" : "that is before the start" }
    }

    case "image": {
      const v = view(saved)
      const [x, y, w, h] = [num(v.x), num(v.y), num(v.w), num(v.h)]
      if (x === null || y === null || w === null || h === null) return { resolution: "exact", position: at({}) }
      const inside = x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= surface.width && y + h <= surface.height
      if (inside) return { resolution: "exact", position: at({}) }
      const requested = `${x},${y},${w},${h}`
      const cw = clamp(w, 1, surface.width)
      const ch = clamp(h, 1, surface.height)
      const cx = clamp(x, 0, surface.width - cw)
      const cy = clamp(y, 0, surface.height - ch)
      const overlaps = x < surface.width && y < surface.height && x + w > 0 && y + h > 0
      const landing = at({ viewState: { ...v, x: cx, y: cy, w: cw, h: ch } })
      return overlaps
        ? { resolution: "nearby", position: landing, requested, reason: "the region ran off the image; it is moved to fit" }
        : { resolution: "fallback", position: at({ viewState: { x: 0, y: 0, w: surface.width, h: surface.height } }), requested, reason: "the region is not on this image; showing all of it" }
    }

    case "map": {
      const v = view(saved)
      const [lat, lon, zoom] = [num(v.lat), num(v.lon), num(v.zoom)]
      if (lat === null || lon === null) return { resolution: "exact", position: at({}) }
      const z = clamp(zoom ?? surface.minZoom, surface.minZoom, surface.maxZoom)
      const inside = lat >= surface.bounds.south && lat <= surface.bounds.north && lon >= surface.bounds.west && lon <= surface.bounds.east
      if (inside && z === (zoom ?? z)) return { resolution: "exact", position: at({}) }
      const clat = clamp(lat, surface.bounds.south, surface.bounds.north)
      const clon = clamp(lon, surface.bounds.west, surface.bounds.east)
      return { resolution: inside ? "nearby" : "fallback", position: at({ viewState: { ...v, lat: clat, lon: clon, zoom: z } }), requested: `${lat},${lon}`, reason: inside ? "the zoom is outside what this map offers" : "that place is outside this map; this is the nearest edge" }
    }
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, "0")}`
const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`

export function describe(surface: Surface, position: Position): string {
  if (position.surfaceId !== surface.id) return "Not on this surface."
  switch (surface.type) {
    case "document": return position.anchor ? `At ${position.anchor}.` : "At the start."
    case "index": {
      const i = position.anchor ? surface.anchors.indexOf(position.anchor) : -1
      return `${surface.label ?? "Index"}${i >= 0 ? `, item ${i + 1} of ${surface.anchors.length}` : `, ${surface.anchors.length} items`}.`
    }
    case "sequence": {
      const i = position.anchor ? surface.members.indexOf(position.anchor) : -1
      return i >= 0 ? `${i + 1} of ${surface.members.length}.` : `${surface.members.length} in the sequence.`
    }
    case "time": {
      const t = num(position.offset) ?? 0
      const chapter = [...(surface.chapters ?? [])].sort((a, b) => b.start - a.start).find((c) => c.start <= t)
      return `${clock(t)} of ${clock(surface.duration)}${chapter ? `, in ${chapter.title ?? chapter.id}` : ""}.`
    }
    case "image": {
      const v = view(position)
      const [x, y, w, h] = [num(v.x), num(v.y), num(v.w), num(v.h)]
      return x === null || y === null || w === null || h === null ? `The whole image, ${surface.width} by ${surface.height}.` : `A region ${w} by ${h}, at ${x}, ${y}, of ${surface.width} by ${surface.height}.`
    }
    case "map": {
      const v = view(position)
      const [lat, lon, zoom] = [num(v.lat), num(v.lon), num(v.zoom)]
      return lat === null || lon === null ? "The whole map." : `${deg(lat, "N", "S")}, ${deg(lon, "E", "W")}${zoom !== null ? `, zoom ${zoom}` : ""}.`
    }
  }
}

export function targetKindFor(surface: Surface): "anchor" | "sequence" | "time" | "region" | "place" {
  return { document: "anchor", index: "anchor", sequence: "sequence", time: "time", image: "region", map: "place" }[surface.type] as never
}

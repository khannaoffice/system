import type { Register } from "./core.ts"

export interface GatheredItem {
  objectId: string
  revisionId: string
  note?: string
}

export interface Gather {
  schemaVersion: "0.1.0"
  id: string
  title: string
  visibility: "private"
  items: GatheredItem[]
}

export const createGather = (id: string, title: string): Gather => ({ schemaVersion: "0.1.0", id, title, visibility: "private", items: [] })

export function addToGather(gather: Gather, item: GatheredItem, at?: number): Gather {
  if (gather.items.some((i) => i.objectId === item.objectId)) return gather
  const items = [...gather.items]
  items.splice(at === undefined ? items.length : Math.max(0, Math.min(at, items.length)), 0, item)
  return { ...gather, items }
}

export const removeFromGather = (gather: Gather, objectId: string): Gather => ({ ...gather, items: gather.items.filter((i) => i.objectId !== objectId) })

export function moveInGather(gather: Gather, objectId: string, to: number): Gather {
  const from = gather.items.findIndex((i) => i.objectId === objectId)
  if (from < 0) return gather
  const items = [...gather.items]
  const [item] = items.splice(from, 1)
  items.splice(Math.max(0, Math.min(to, items.length)), 0, item)
  return { ...gather, items }
}

export const noteOnGather = (gather: Gather, objectId: string, note: string | undefined): Gather => ({
  ...gather,
  items: gather.items.map((i) => (i.objectId === objectId ? { ...i, ...(note ? { note } : { note: undefined }) } : i)),
})

export function exportGather(gather: Gather, register: Register) {
  return {
    schemaVersion: gather.schemaVersion,
    id: gather.id,
    title: gather.title,
    scope: register.scope,
    items: gather.items.map((item, position) => {
      const object = register.objects.find((o) => o.id === item.objectId)
      const gone = item.objectId in register.withdrawn || !object
      return {
        position,
        objectId: item.objectId,
        revisionId: item.revisionId,
        ...(item.note ? { note: item.note } : {}),
        state: gone ? ("unavailable" as const) : object!.revisionId === item.revisionId ? ("current" as const) : ("revised" as const),
        ...(object ? { title: object.title, canonicalUri: object.canonicalUri } : {}),
      }
    }),
  }
}

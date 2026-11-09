import type { Gather } from "../../core/src/gather.ts"
import type { Position } from "../../core/src/position.ts"
import type { Store } from "./store.ts"

export function personal(store: Store) {
  return {
    gathers: {
      async list(): Promise<Gather[]> {
        const keys = await store.keys("gather:")
        const found = await Promise.all(keys.map((k) => store.get<Gather>(k)))
        return found.filter((g): g is Gather => g !== undefined)
      },
      load: (id: string) => store.get<Gather>(`gather:${id}`),
      async save(gather: Gather) {
        if (gather.visibility !== "private") throw new Error("Personal storage holds private gathers only.")
        await store.set(`gather:${gather.id}`, gather)
      },
      remove: (id: string) => store.delete(`gather:${id}`),
    },
    positions: {
      load: (surfaceId: string) => store.get<Position>(`position:${surfaceId}`),
      save: (position: Position) => store.set(`position:${position.surfaceId}`, position),
    },
  }
}

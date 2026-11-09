export interface Position {
  surfaceId: string
  objectId?: string
  revisionId?: string
  anchor?: string
  axis?: "block" | "inline" | "time" | "x" | "y"
  offset?: number
  nearby?: string[]
  selection?: { anchor: string; start?: number; end?: number }
  viewState?: Record<string, string | number | boolean>
  capturedAt?: string
}

export interface SurfaceNow {
  surfaceId: string
  revisionId?: string
  anchors: string[]
}

export type Restored =
  | { resolution: "exact"; anchor: string | null; revisionChanged: boolean }
  | { resolution: "nearby"; anchor: string; requested: string; revisionChanged: boolean }
  | { resolution: "fallback"; anchor: null; requested: string | null; reason: "surface-differs" | "anchor-gone"; revisionChanged: boolean }

export function restorePosition(position: Position, surface: SurfaceNow): Restored {
  const revisionChanged = position.revisionId !== undefined && surface.revisionId !== undefined && position.revisionId !== surface.revisionId
  const requested = position.anchor ?? null
  if (position.surfaceId !== surface.surfaceId) return { resolution: "fallback", anchor: null, requested, reason: "surface-differs", revisionChanged }
  if (requested === null) return { resolution: "exact", anchor: null, revisionChanged }
  const have = new Set(surface.anchors)
  if (have.has(requested)) return { resolution: "exact", anchor: requested, revisionChanged }
  const near = (position.nearby ?? []).find((a) => have.has(a))
  if (near) return { resolution: "nearby", anchor: near, requested, revisionChanged }
  return { resolution: "fallback", anchor: null, requested, reason: "anchor-gone", revisionChanged }
}

export function positionToQuery(position: Position): string {
  const params = new URLSearchParams()
  if (position.anchor) params.set("at", position.anchor)
  if (position.offset !== undefined) params.set("offset", String(position.offset))
  if (position.revisionId) params.set("revision", position.revisionId)
  return params.toString()
}

export function positionFromQuery(surfaceId: string, query: string): Position {
  const params = new URLSearchParams(query)
  const offset = params.get("offset")
  return {
    surfaceId,
    ...(params.get("at") ? { anchor: params.get("at")! } : {}),
    ...(offset !== null && Number.isFinite(Number(offset)) ? { offset: Number(offset) } : {}),
    ...(params.get("revision") ? { revisionId: params.get("revision")! } : {}),
  }
}

export type ParticipantKind = "human" | "agent"

export interface Positions {
  positions: Record<string, Position>
  following: Record<string, string>
}

export const emptyPositions = (): Positions => ({ positions: {}, following: {} })

export function setPosition(state: Positions, participantId: string, position: Position): Positions {
  return { ...state, positions: { ...state.positions, [participantId]: position } }
}

export function follow(state: Positions, followerId: string, targetId: string): Positions {
  return { ...state, following: { ...state.following, [followerId]: targetId } }
}

export function unfollow(state: Positions, followerId: string): Positions {
  const { [followerId]: _gone, ...following } = state.following
  return { ...state, following }
}

export function viewOf(state: Positions, participantId: string): Position | undefined {
  const target = state.following[participantId]
  return state.positions[target ?? participantId] ?? state.positions[participantId]
}

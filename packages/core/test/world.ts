import { newWorld, type World } from "../src/operations.ts"
import type { Grant, Participant } from "../src/authority.ts"
import { fixture } from "./helpers.ts"

export const OWNER: Participant = { id: "rohan", kind: "human" }
export const AGENT: Participant = { id: "agent-1", kind: "agent" }
export const OTHER: Participant = { id: "someone-else", kind: "human" }
export const ORIGIN = "https://rohankhanna.com"

export function makeWorld() {
  let t = Date.parse("2026-11-04T12:00:00.000Z")
  const clock = () => new Date(t).toISOString()
  const tick = (ms: number) => { t += ms }
  const world = newWorld(fixture(), OWNER.id, { clock })
  let n = 0
  const grant = (scopes: string[], extra: Partial<Grant> = {}): Grant => {
    const g: Grant = { id: `grant-${++n}`, principal: OWNER.id, actor: AGENT.id, scopes, resources: ["*"], grantedAt: clock(), expiresAt: new Date(t + 3600_000).toISOString(), ...extra }
    world.grants.push(g)
    return g
  }
  return { world, tick, clock, grant }
}

export const snapshot = (w: World) => JSON.stringify({ register: w.register, receipts: w.receipts, annotations: w.annotations, proposals: w.proposals })

export const ok = <T>(r: { status: string; data?: T; error?: unknown }): T => {
  if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`)
  return r.data as T
}
export const code = (r: { status: string; error?: { code: string } }) => (r.error ? `${r.status}/${r.error.code}` : r.status)

import type { Capability } from "./capabilities.ts"

export interface Participant {
  id: string
  kind: "human" | "agent" | "service"
}

export interface Grant {
  id: string
  principal: string
  actor: string
  scopes: string[]
  resources: string[]
  origins?: string[]
  grantedAt: string
  expiresAt: string
  revokedAt?: string
}

export interface AuthContext {
  actor: Participant
  grants: Grant[]
  owner: string
  now: string
  origin?: string
}

export type DenyReason = "no_grant" | "expired" | "revoked" | "scope" | "resource" | "origin"

export type Decision =
  | { decision: "allow"; principal: string; grant?: string }
  | { decision: "denied"; reason: DenyReason; message: string }

const DENIAL: Record<DenyReason, string> = {
  no_grant: "No grant gives this participant authority over this.",
  expired: "The grant that would allow this has expired.",
  revoked: "The grant that would allow this has been revoked.",
  scope: "The grant does not include the permission this needs.",
  resource: "The grant does not cover this resource.",
  origin: "The grant does not allow requests from this origin.",
}
const denied = (reason: DenyReason): Decision => ({ decision: "denied", reason, message: DENIAL[reason] })

const OPEN = new Set(["read:public", "position:own"])

export function authorize(ctx: AuthContext, capability: Pick<Capability, "scopes">, resource: string): Decision {
  const needed = capability.scopes.filter((s) => !OPEN.has(s))
  if (needed.length === 0) return { decision: "allow", principal: ctx.actor.id }
  if (ctx.actor.kind === "human" && ctx.actor.id === ctx.owner) return { decision: "allow", principal: ctx.owner }

  const mine = ctx.grants.filter((g) => g.actor === ctx.actor.id)
  if (mine.length === 0) return denied("no_grant")
  let best: DenyReason = "scope"
  for (const grant of mine) {
    if (grant.revokedAt !== undefined && grant.revokedAt <= ctx.now) { best = "revoked"; continue }
    if (grant.expiresAt <= ctx.now) { best = best === "revoked" ? best : "expired"; continue }
    if (!needed.every((s) => grant.scopes.includes(s))) continue
    if (!grant.resources.includes("*") && !grant.resources.includes(resource)) { best = "resource"; continue }
    if (grant.origins && (ctx.origin === undefined || !grant.origins.includes(ctx.origin))) { best = "origin"; continue }
    return { decision: "allow", principal: grant.principal, grant: grant.id }
  }
  return denied(best)
}

export function needsApproval(capability: Pick<Capability, "confirmation" | "effect">): boolean {
  return capability.confirmation === "required" || capability.effect === "consequential" || capability.effect === "irreversible"
}

export function mayApprove(approver: Participant, principal: string): boolean {
  return approver.kind === "human" && approver.id === principal
}

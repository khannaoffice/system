import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { World, Receipt } from "../../../core/src/operations.ts"
import type { Collection, SystemObject } from "../../../core/src/core.ts"
import { renderChange, type RenderedChange } from "./render.ts"

export { pretty, renderChange } from "./render.ts"
export type { RenderedChange }

const git = (repoDir: string, args: string[], input?: string) => execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim()

export interface Published {
  sha: string
  created: boolean
  files: string[]
}

export function publishToGit(world: World, operationId: string, options: { repoDir: string; author: { name: string; email: string } }): Published {
  const { repoDir, author } = options
  const change = renderChange(world, operationId)
  const existing = git(repoDir, ["log", "--all", "-E", `--grep=^KO-Operation: ${operationId}$`, "--format=%H", "-1"])
  if (existing) return { sha: existing, created: false, files: change.files.map((f) => f.path) }
  for (const file of change.files) {
    const path = join(repoDir, file.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.content)
  }
  const paths = change.files.map((f) => f.path)
  git(repoDir, ["add", "--", ...paths])
  const message = `${change.subject}\n\n${change.body}\n\n${change.trailers.join("\n")}\n`
  git(repoDir, ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-q", "-m", message, "--", ...paths])
  return { sha: git(repoDir, ["rev-parse", "HEAD"]), created: true, files: paths }
}

export function readContent(repoDir: string): { objects: SystemObject[]; collections: Collection[] } {
  const read = <T>(dir: string): T[] => {
    const path = join(repoDir, dir)
    return existsSync(path) ? readdirSync(path).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(path, f), "utf8")) as T) : []
  }
  return { objects: read<SystemObject>("content/objects"), collections: read<Collection>("content/collections") }
}

export function historyOf(repoDir: string): { sha: string; operationId: string; receiptId: string; capability: string; principal: string; actor: string }[] {
  const out = git(repoDir, ["log", "--format=%H%x1f%B%x1e"])
  return out.split("\x1e").map((r) => r.trim()).filter(Boolean).flatMap((record) => {
    const [sha, body] = record.split("\x1f")
    const t = (k: string) => new RegExp(`^KO-${k}: (.+)$`, "m").exec(body)?.[1]
    return t("Operation") ? [{ sha, operationId: t("Operation")!, receiptId: t("Receipt")!, capability: t("Capability")!, principal: t("Principal")!, actor: t("Actor")! }] : []
  })
}

export type { Receipt }

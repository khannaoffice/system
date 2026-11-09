import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { Register } from "../src/core.ts"

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
export const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"))
export const fixture = (): Register => read("fixtures/rohankhanna/register.json")

export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const require = createRequire(import.meta.url)
export const Ajv2020 = require("ajv/dist/2020").default
export const addFormats = require("ajv-formats").default

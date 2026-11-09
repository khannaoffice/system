import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Store } from "./store.ts"

const file = (dir: string, key: string) => join(dir, `${encodeURIComponent(key)}.json`)

export function fileStore(dir: string): Store {
  mkdirSync(dir, { recursive: true })
  return {
    async get<T>(key: string) {
      const path = file(dir, key)
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined
    },
    async set(key, value) {
      const path = file(dir, key)
      const temporary = `${path}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n")
      renameSync(temporary, path)
    },
    async delete(key) {
      rmSync(file(dir, key), { force: true })
    },
    async keys(prefix = "") {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => decodeURIComponent(f.slice(0, -".json".length)))
        .filter((k) => k.startsWith(prefix))
        .sort()
    },
  }
}

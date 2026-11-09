export interface Store {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export function memoryStore(): Store {
  const data = new Map<string, string>()
  return {
    async get<T>(key: string) {
      const raw = data.get(key)
      return raw === undefined ? undefined : (JSON.parse(raw) as T)
    },
    async set(key, value) { data.set(key, JSON.stringify(value)) },
    async delete(key) { data.delete(key) },
    async keys(prefix = "") { return [...data.keys()].filter((k) => k.startsWith(prefix)).sort() },
  }
}

const TABLE = "personal"

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})

export function idbStore(name = "khannaoffice-system", factory: IDBFactory = indexedDB): Store {
  let opened: Promise<IDBDatabase> | null = null
  const open = () => (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { opened = null; reject(req.error) }
  }))
  const table = async (mode: IDBTransactionMode) => (await open()).transaction(TABLE, mode).objectStore(TABLE)
  return {
    async get<T>(key: string) { return (await request((await table("readonly")).get(key))) as T | undefined },
    async set(key, value) { await request((await table("readwrite")).put(JSON.parse(JSON.stringify(value)), key)) },
    async delete(key) { await request((await table("readwrite")).delete(key)) },
    async keys(prefix = "") {
      const all = (await request((await table("readonly")).getAllKeys())) as string[]
      return all.filter((k) => k.startsWith(prefix)).sort()
    },
  }
}

export async function openStore(name?: string): Promise<{ store: Store; persistent: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB")
    const store = idbStore(name)
    await store.keys()
    return { store, persistent: true }
  } catch {
    return { store: memoryStore(), persistent: false }
  }
}

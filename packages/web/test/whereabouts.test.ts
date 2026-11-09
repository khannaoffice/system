import { test } from "node:test"
import assert from "node:assert/strict"
import { ATTRIBUTE, TRAVELLING, canMove, move, moveFor, type Whereabouts } from "../src/whereabouts.ts"

const PLACES = ["/", "/about/", "/works/"]
const site: Whereabouts = {
  position: (path) => (PLACES.includes(path) ? PLACES.indexOf(path) : PLACES.length),
  parent: (path) => (path.startsWith("/works/") && path !== "/works/" ? "/works/" : null),
}

test("forward along the surface, and back", () => {
  assert.equal(moveFor(site, "/", "/about/"), "forward")
  assert.equal(moveFor(site, "/works/", "/"), "back")
})

test("into a piece from its list, and back out", () => {
  assert.equal(moveFor(site, "/works/", "/works/a-piece/"), "zoom-in")
  assert.equal(moveFor(site, "/works/a-piece/", "/works/"), "zoom-out")
})

test("a query or a fragment is not a move", () => {
  assert.equal(moveFor(site, "/works/", "/works/?kind=video"), null)
  assert.equal(moveFor(site, "/about/", "/about/#contact"), null)
})

test("into from elsewhere is along, not a zoom", () => {
  assert.equal(moveFor(site, "/about/", "/works/a-piece/"), "forward")
})

test("without parents, every move is along", () => {
  const flat: Whereabouts = { position: site.position }
  assert.equal(moveFor(flat, "/works/", "/works/a-piece/"), "forward")
})

function standIn({ reducedMotion = false } = {}) {
  const attributes = new Map<string, string>()
  const properties = new Map<string, string>()
  const listening = new Set<string>()
  const done: { finish: () => void }[] = []
  const element = (box: { left: number; top: number; width: number; height: number }) => {
    const own = new Set<string>()
    return {
      getBoundingClientRect: () => box,
      setAttribute: (name: string) => void own.add(name),
      removeAttribute: (name: string) => void own.delete(name),
      hasAttribute: (name: string) => own.has(name),
    }
  }
  const title = element({ left: 100, top: 200, width: 40, height: 20 })
  const link = element({ left: 300, top: 400, width: 100, height: 20 })
  const g = globalThis as Record<string, unknown>
  const saved = { window: g.window, document: g.document }
  g.window = {
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener: (type: string) => void listening.add(type),
    removeEventListener: (type: string) => void listening.delete(type),
  }
  g.document = {
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
      style: { setProperty: (name: string, value: string) => void properties.set(name, value), removeProperty: (name: string) => void properties.delete(name) },
    },
    querySelectorAll: () => [title, link].filter((el) => el.hasAttribute(TRAVELLING)),
    getAnimations: () => [],
    startViewTransition(update: () => Promise<void>) {
      let finish = () => {}
      const finished = new Promise<void>((resolve) => { finish = resolve })
      done.push({ finish })
      const updated = update()
      return { ready: updated, updateCallbackDone: updated, finished, skipTransition() {} }
    },
  }
  return { attributes, properties, listening, done, title, link, restore: () => { g.window = saved.window; g.document = saved.document } }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test("without View Transitions the page simply changes", () => {
  let changed = 0
  assert.equal(canMove(), false)
  assert.equal(move(site, "/", "/about/", () => { changed += 1 }), null)
  assert.equal(changed, 1)
})

test("where motion is not wanted the page simply changes", () => {
  const page = standIn({ reducedMotion: true })
  try {
    let changed = 0
    assert.equal(canMove(), false)
    assert.equal(move(site, "/", "/about/", () => { changed += 1 }), null)
    assert.equal(changed, 1)
    assert.equal(page.attributes.size, 0)
  } finally { page.restore() }
})

test("a path that does not move changes the page without a move", () => {
  const page = standIn()
  try {
    let changed = 0
    assert.equal(move(site, "/works/", "/works/?kind=video", () => { changed += 1 }), null)
    assert.equal(changed, 1)
    assert.equal(page.done.length, 0)
  } finally { page.restore() }
})

test("a move along names its way on the page for its length, then clears it", async () => {
  const page = standIn()
  try {
    let changed = 0
    const transition = move(site, "/", "/about/", () => { changed += 1 })
    assert.ok(transition)
    assert.equal(page.attributes.get(ATTRIBUTE), "forward")
    assert.equal(changed, 1)
    assert.equal(page.properties.has("--zoom-x"), false, "a slide has no point to zoom on")
    assert.ok(page.listening.has("pointerdown"), "input during the move is listened for, to finish it")
    page.done[0].finish()
    await settle()
    assert.equal(page.attributes.has(ATTRIBUTE), false)
    assert.equal(page.listening.size, 0)
  } finally { page.restore() }
})

test("a move into a piece zooms on the link it came from, and its travellers are marked on both pages", async () => {
  const page = standIn()
  try {
    const marked: boolean[] = []
    const into: Whereabouts = { ...site, focus: () => page.link as unknown as Element, travellers: () => [page.title as unknown as Element] }
    move(into, "/works/", "/works/a-piece/", () => { marked.push(page.title.hasAttribute(TRAVELLING)) })
    assert.equal(page.attributes.get(ATTRIBUTE), "zoom-in")
    assert.equal(page.properties.get("--zoom-x"), "350px")
    assert.equal(page.properties.get("--zoom-y"), "410px")
    assert.deepEqual(marked, [true], "marked before the old page is captured")
    await settle()
    assert.equal(page.title.hasAttribute(TRAVELLING), true, "and again once the new page is in the document")
    page.done[0].finish()
    await settle()
    assert.equal(page.title.hasAttribute(TRAVELLING), false)
    assert.equal(page.attributes.has(ATTRIBUTE), false)
  } finally { page.restore() }
})

test("a move waits for a router that renders after it is asked", async () => {
  const page = standIn()
  try {
    const order: string[] = []
    const slow: Whereabouts = { ...site, ready: async (path) => { order.push(`ready ${path}`) } }
    move(slow, "/", "/about/?from=home", () => { order.push("update") })
    await settle()
    assert.deepEqual(order, ["update", "ready /about/"])
    page.done[0].finish()
    await settle()
  } finally { page.restore() }
})

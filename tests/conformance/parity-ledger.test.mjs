import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { homedir } from "node:os"

const base = process.env.SITE_URL
const repo = (process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir())
const skip = base ? false : "set SITE_URL (and SITE_REPO) to run the parity check against a live site"

const api = async (path) => {
  const res = await fetch(new URL(path, base), { redirect: "follow" })
  const body = await res.json()
  assert.equal(body.status, "ok", path)
  return body.data
}
const apiIds = async (type, order) => {
  const ids = []
  let cursor
  do {
    const q = new URLSearchParams({ order, limit: "200", ...(type ? { type } : {}), ...(cursor ? { cursor } : {}) })
    const page = await api(`/api/v1/objects/?${q}`)
    ids.push(...page.items.map((o) => o.id))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return ids
}

test("C-24.2-4 the Index shows what the API returns, in the same order, by address and by click", { skip }, async () => {
  const { chromium } = createRequire(join(repo, "package.json"))("playwright")
  const browser = await chromium.launch({ channel: "chrome" })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    const page = await context.newPage()
    const shown = () => page.$$eval("li[data-ko-id]", (rows) => rows.map((r) => r.getAttribute("data-ko-id")))
    const root = await api("/api/v1/")
    const kinds = [null, ...root.types.map((t) => t.type)]
    let compared = 0

    for (const kind of kinds) {
      for (const oldest of [false, true]) {
        const url = `/works/?${new URLSearchParams({ ...(kind ? { kind: kind.toLowerCase() } : {}), ...(oldest ? { order: "oldest" } : {}) })}`
        await page.goto(base + url, { waitUntil: "networkidle" })
        const expected = await apiIds(kind, oldest ? "date:asc" : "date:desc")
        assert.deepEqual(await shown(), expected, `by address ${url}`)
        compared += 1
      }
    }

    await page.goto(`${base}/works/`, { waitUntil: "networkidle" })
    for (const kind of root.types.map((t) => t.type)) {
      const button = page.locator("nav.kinds button", { has: page.locator(".kind-label", { hasText: new RegExp(`^${kind}$`) }) })
      await button.click()
      await page.waitForFunction((k) => document.querySelector('nav.kinds [aria-pressed="true"] .kind-label')?.textContent === k, kind)
      assert.deepEqual(await shown(), await apiIds(kind, "date:desc"), `by click ${kind}`)
      await button.click()
      await page.waitForFunction(() => document.querySelector(".sort-direction[data-oldest]") !== null)
      assert.deepEqual(await shown(), await apiIds(kind, "date:asc"), `by click ${kind}, reversed`)
      compared += 2
    }

    await page.goto(`${base}/works/`, { waitUntil: "networkidle" })
    const counts = await page.$$eval("nav.kinds button", (bs) => bs.map((b) => [b.querySelector(".kind-label")?.textContent, Number(b.querySelector(".count")?.textContent)]))
    assert.deepEqual(Object.fromEntries(counts), { All: root.objects, ...Object.fromEntries(root.types.map((t) => [t.type, t.count])) })
    assert.ok(compared >= 2 * (kinds.length + root.types.length), "every kind compared both ways")
  } finally {
    await browser.close()
  }
})

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { homedir } from "node:os"
import { createHash } from "node:crypto"

const base = process.env.SITE_URL
const repo = (process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir())
const skip = base ? false : "set SITE_URL (and SITE_REPO) to run against a live site"

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
let browser
before(async () => {
  if (skip) return
  const { chromium } = createRequire(join(repo, "package.json"))("playwright")
  browser = await chromium.launch({ channel: "chrome" })
})
after(async () => { await browser?.close() })

async function withPage(options, fn) {
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce", ...options })
  try {
    const page = await context.newPage()
    return await fn(page)
  } finally {
    await context.close()
  }
}
const go = (page, path) => page.goto(base + path, { waitUntil: "networkidle" })
const api = async (path) => (await (await fetch(new URL(path, base), { redirect: "follow" })).json()).data
const rows = (page) => page.$$eval("li[data-ko-id]", (r) => r.map((x) => x.getAttribute("data-ko-id")))
const pressed = (page) => page.$eval('nav.kinds [aria-pressed="true"] .kind-label', (e) => e.textContent)
const oldest = (page) => page.$eval(".sort-direction", (e) => e.hasAttribute("data-oldest")).catch(() => false)
const objects = async () => (await api("/api/v1/objects/?limit=200")).items
const internalPages = async () => (await objects()).filter((o) => o.representations.some((r) => r.role === "page" && r.href.startsWith("/")))

test("C-24.3-1 a direct link restores a meaningful position, with no history behind it", { skip }, async () => {
  const pages = await internalPages()
  assert.ok(pages.length >= 10)
  for (const object of pages) {
    const href = object.representations.find((r) => r.role === "page").href
    await withPage({}, async (page) => {
      const response = await page.goto(base + href, { waitUntil: "load" })
      assert.equal(response.status(), 200, href)
      const arrival = await page.evaluate(() => ({ type: performance.getEntriesByType("navigation")[0].type, referrer: document.referrer }))
      assert.deepEqual(arrival, { type: "navigate", referrer: "" }, "a fresh visit: no history, no referrer")
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
      const plain = (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').toLowerCase()
      assert.ok(plain(text).includes(plain(object.title)) || plain(await page.title()).includes(plain(object.title)), `${href} names its piece "${object.title}"`)
      assert.ok((await page.title()).length > 0, `${href} has a title`)
    })
  }
  await withPage({}, async (page) => {
    await go(page, "/works/?kind=event&order=oldest")
    assert.equal(await pressed(page), "Event")
    assert.equal(await oldest(page), true)
  })
  await withPage({}, async (page) => {
    const res = await page.goto(base + "/works/no-such-piece/", { waitUntil: "load" })
    assert.equal(res.status(), 404, "an address that names nothing says so")
  })
})

test("C-24.3-2 browser navigation returns to the previous context", { skip }, async () => {
  await withPage({}, async (page) => {
    await go(page, "/works/?kind=photograph&order=oldest")
    const before = { rows: await rows(page), kind: await pressed(page), oldest: await oldest(page) }
    assert.ok(before.rows.length >= 2 && before.oldest)
    await page.locator("li[data-ko-id] a.travels").first().click()
    await page.waitForURL(/\/works\/(?!\?)[^/]+\/$/)
    await page.goBack()
    await page.waitForURL(/\/works\/\?kind=photograph/)
    await page.waitForSelector("li[data-ko-id]")
    assert.deepEqual({ rows: await rows(page), kind: await pressed(page), oldest: await oldest(page) }, before)
    await page.goForward()
    await page.waitForURL(/\/works\/(?!\?)[^/]+\/$/)
  })
  await withPage({}, async (page) => {
    await go(page, "/about/")
    await page.locator('a[href="/works/"]').first().click()
    await page.waitForURL(/\/works\/$/)
    const length = await page.evaluate(() => history.length)
    await page.locator("nav.kinds button", { hasText: /^Event/ }).click()
    await page.locator("nav.kinds button", { hasText: /^Writing/ }).click()
    assert.equal(await page.evaluate(() => history.length), length, "filtering adds no history entries")
    await page.goBack()
    await page.waitForURL(/\/about\/$/)
  })
})

test("C-24.3-3 resizing the surface preserves the reader's place and choices", { skip }, async () => {
  await withPage({}, async (page) => {
    await go(page, "/works/?kind=event&order=oldest")
    const before = await rows(page)
    for (const size of [PHONE, { width: 820, height: 1100 }, { width: 320, height: 600 }, DESKTOP]) {
      await page.setViewportSize(size)
      await page.waitForTimeout(250)
      assert.deepEqual(await rows(page), before, `rows unchanged at ${size.width}`)
      assert.equal(await pressed(page), "Event", `kind kept at ${size.width}`)
      assert.equal(await oldest(page), true, `order kept at ${size.width}`)
      assert.equal(new URL(page.url()).search, "?kind=event&order=oldest")
      const inView = await page.$eval('nav.kinds [aria-pressed="true"]', (b) => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 })
      assert.ok(inView, `the chosen kind stays visible in its strip at ${size.width}`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no sideways scroll at ${size.width}`)
    }
  })
})

test("C-24.6-1 Unigrid geometry: fixed proportions, one module at every width", { skip }, async () => {
  const B = { w: 84, h: 80, gx: 12, gy: 10 }
  const seen = new Set()
  for (const width of [1440, 1024, 768, 390, 320]) {
    await withPage({ viewport: { width, height: 900 } }, async (page) => {
      await go(page, "/works/")
      const g = await page.$eval("[data-kho-unigrid]", (el) => {
        const s = el.style
        const f = (n) => parseFloat(s.getPropertyValue(n))
        return { w: f("--kho-unigrid-module-width"), h: f("--kho-unigrid-module-height"), gx: f("--kho-unigrid-column-gap"), gy: f("--kho-unigrid-row-gap"), cols: f("--kho-unigrid-columns") }
      })
      const scale = g.w / B.w
      for (const k of ["h", "gx", "gy"]) assert.ok(Math.abs(g[k] - B[k] * scale) < 0.01, `${width}px: ${k} keeps the B-module's proportion (${g[k]} vs ${B[k] * scale})`)
      assert.ok(Number.isInteger(g.cols) && g.cols >= 1 && g.cols <= 12, `${width}px: whole columns`)
      seen.add([g.w, g.h, g.gx, g.gy].map((n) => n.toFixed(3)).join("x"))
      const cells = await page.$$eval("[data-kho-unigrid-cell]", (cs) => cs.map((c) => [c.dataset.khoUnigridW, c.dataset.khoUnigridH]))
      for (const [w, h] of cells) assert.ok(Number.isInteger(Number(w)) && Number.isInteger(Number(h)), "integer spans")
    })
  }
  assert.equal(seen.size, 1, `the module is one size at every width, got ${[...seen]}`)
})

test("C-24.6-2 layouts give up columns, never shape: they fit and never scroll sideways", { skip }, async () => {
  const pages = ["/", "/about/", "/works/", (await internalPages())[0].representations[0].href]
  for (const path of pages) {
    let last = 0
    for (const width of [320, 390, 600, 820, 1024, 1440, 1920]) {
      await withPage({ viewport: { width, height: 900 } }, async (page) => {
        await go(page, path)
        const r = await page.$eval("[data-kho-unigrid]", (el) => ({ cols: Number(el.dataset.khoUnigridColumns), state: el.dataset.khoUnigridState, field: parseFloat(el.style.getPropertyValue("--kho-unigrid-field-width")), authored: Number(el.dataset.khoUnigridAuthoredColumns) }))
        assert.ok(r.field <= width + 0.5, `${path} @${width}: the field (${r.field}) fits the window`)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} @${width}: no sideways scroll`)
        assert.ok(r.cols >= last, `${path} @${width}: columns only grow with width (${r.cols} after ${last})`)
        assert.equal(r.state, r.cols >= r.authored ? "authored" : "reflow", `${path} @${width}: the layout says which it is`)
        last = r.cols
      })
    }
  }
})

test("C-24.6-3 loading adds no layout shift a reader would feel", { skip }, async () => {
  const paths = ["/", "/about/", "/works/", ...(await internalPages()).map((o) => o.representations.find((r) => r.role === "page").href)]
  let worst = 0
  for (const viewport of [DESKTOP, PHONE]) {
    for (const path of paths) {
      await withPage({ viewport }, async (page) => {
        await page.addInitScript(() => {
          window.__cls = 0
          new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: "layout-shift", buffered: true })
        })
        await go(page, path)
        for (let y = 0; y < 6000; y += 700) { await page.mouse.wheel(0, 700); await page.waitForTimeout(60) }
        await page.waitForTimeout(400)
        const cls = await page.evaluate(() => window.__cls)
        worst = Math.max(worst, cls)
        assert.ok(cls <= 0.1, `${path} @${viewport.width}: CLS ${cls.toFixed(4)} is over the good threshold (SPEC 25.1)`)
      })
    }
  }
  console.log(`  worst CLS across ${paths.length * 2} loads: ${worst.toFixed(4)}`)
})

test("C-24.6-4 every control works from the keyboard, and focus shows where it is", { skip }, async () => {
  await withPage({}, async (page) => {
    await go(page, "/works/")
    const interactive = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && !e.closest("[inert],[aria-hidden=true]"))
      els.forEach((e, i) => e.setAttribute("data-probe", String(i)))
      return els.length
    })
    assert.ok(interactive > 20)
    const target = (probe) => {
      const control = page.locator(`[data-probe="${probe}"]`)
      return control.locator("xpath=ancestor-or-self::li[@data-ko-id] | self::*[not(ancestor::li[@data-ko-id])]").last()
    }
    const look = async (probe) => createHash("sha256").update(await target(probe).screenshot({ animations: "disabled" })).digest("hex")
    await page.mouse.move(2, 2)
    const baseline = []
    for (let i = 0; i < interactive; i++) baseline.push(await look(String(i)))
    const sequence = []
    const unmarked = []
    for (let i = 0; i < interactive + 5; i++) {
      await page.keyboard.press("Tab")
      const probe = await page.evaluate(() => document.activeElement.getAttribute("data-probe"))
      if (probe === null) break
      await page.waitForTimeout(450)
      if ((await look(probe)) === baseline[Number(probe)]) {
        unmarked.push(await page.evaluate((p) => { const e = document.querySelector(`[data-probe="${p}"]`); return `${p}:${e.tagName.toLowerCase()}:${(e.textContent || "").trim().slice(0, 24)}` }, probe))
      }
      sequence.push(probe)
    }
    const reached = new Set(sequence)
    const missed = [...Array(interactive).keys()].map(String).filter((p) => !reached.has(p))
    assert.deepEqual(missed, [], `every control is reachable by Tab (missed probes ${missed})`)
    assert.deepEqual(unmarked, [], `focus changes the look of every control it lands on (unmarked probes ${unmarked})`)
  })
  await withPage({}, async (page) => {
    await go(page, "/works/")
    await page.locator("nav.kinds button", { hasText: /^Photograph/ }).focus()
    await page.keyboard.press("Enter")
    assert.equal(await pressed(page), "Photograph", "Enter chooses a kind")
    await page.keyboard.press("Space")
    assert.equal(await oldest(page), true, "Space on the chosen kind reverses it")
    await page.locator("nav.kinds button", { hasText: /^All/ }).focus()
    await page.keyboard.press("Enter")
    assert.equal(await pressed(page), "All")
    await page.locator("li[data-ko-id] a.travels").first().focus()
    const marks = await page.evaluate(() => { const li = document.activeElement.closest("li"); return { rule: getComputedStyle(li.querySelector(".rule")).backgroundColor, ink: getComputedStyle(document.body).color, focusVisible: document.activeElement.matches(":focus-visible") } })
    assert.equal(marks.focusVisible, true)
    assert.equal(marks.rule, marks.ink, "the focused row's hairline is in ink")
    await page.keyboard.press("Enter")
    await page.waitForURL(/\/works\/[^/?]+\/$/)
  })
})

test("C-24.6-5 reduced motion is respected: no transition runs, and the page still changes", { skip }, async () => {
  const count = async (reducedMotion) => withPage({ reducedMotion }, async (page) => {
    await page.addInitScript(() => {
      window.__vt = 0
      const original = document.startViewTransition?.bind(document)
      if (original) document.startViewTransition = (...a) => { window.__vt += 1; return original(...a) }
    })
    await go(page, "/works/")
    await page.locator("nav.kinds button", { hasText: /^Event/ }).click()
    await page.locator("nav.kinds button", { hasText: /^Writing/ }).click()
    await page.waitForTimeout(300)
    assert.equal(await pressed(page), "Writing", "the page changed")
    await page.locator("li[data-ko-id] a.travels").first().click()
    await page.waitForURL(/\/works\/[^/?]+\/$/)
    return page.evaluate(() => window.__vt)
  })
  assert.ok((await count("no-preference")) > 0, "control: with motion allowed, transitions do run (so this test can fail)")
  assert.equal(await count("reduce"), 0, "with reduced motion, none run")
})

test("C-24.6-6 thread navigation is available without hover, on every device", { skip }, async () => {
  const root = await api("/api/v1/")
  const threads = root.collections.filter((c) => c.kind === "thread")
  assert.ok(threads.length >= 3)
  const members = async (id) => (await api(`/api/v1/collections/${id}/`)).members.length

  await withPage({ viewport: PHONE, hasTouch: true, isMobile: true }, async (page) => {
    await go(page, "/works/")
    const names = await page.$$eval(".thread-toggle", (b) => [...new Set(b.map((x) => x.textContent))])
    assert.deepEqual(names.sort(), threads.map((t) => t.title).sort(), "every thread is reachable from the Index on a phone")
    for (const thread of threads) {
      const toggle = page.locator(".thread-toggle", { hasText: new RegExp(`^${thread.title}$`) }).first()
      await toggle.scrollIntoViewIfNeeded()
      await toggle.tap()
      await page.waitForFunction(() => document.querySelector(".thread-panel:popover-open"))
      const open = page.locator(".thread-panel:popover-open")
      assert.equal(await open.locator("a").count(), (await members(thread.id)) - 1, `${thread.title}: the list is the thread's other pieces`)
      await page.waitForFunction(() => document.querySelector('.thread-toggle[aria-expanded="true"]'))
      await toggle.tap()
      await page.waitForFunction(() => !document.querySelector(".thread-panel:popover-open"))
      await toggle.tap()
      await page.waitForFunction(() => document.querySelector(".thread-panel:popover-open"))
      await page.touchscreen.tap(8, 400)
      await page.waitForFunction(() => !document.querySelector(".thread-panel:popover-open"))
    }
  })

  await withPage({ viewport: PHONE, hasTouch: true, isMobile: true }, async (page) => {
    await go(page, "/works/")
    const toggle = page.locator(".thread-toggle", { hasText: /^McGill$/ }).last()
    await toggle.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 40))
    const before = await page.evaluate(() => Math.round(scrollY))
    assert.ok(before > 800, `this row is deep in the page (${before}px)`)
    const rowBefore = await toggle.evaluate((e) => e.closest("li").getAttribute("data-ko-id"))
    await toggle.tap()
    await page.waitForFunction(() => document.querySelector(".thread-panel:popover-open"))
    await page.locator(".thread-panel:popover-open a").first().tap()
    await page.waitForURL((u) => u.origin !== new URL(base).origin || u.pathname !== "/works/", { timeout: 10000 }).catch(() => {})
    if (new URL(page.url()).pathname === "/works/") throw new Error("tapping a member of the thread did not go anywhere")
    await page.goBack()
    await page.waitForURL(/\/works\/$/)
    await page.waitForSelector("li[data-ko-id]")
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => Math.round(scrollY))
    assert.ok(Math.abs(after - before) <= 40, `back lands where you were: ${before}px before, ${after}px after`)
    assert.equal(await page.locator(`li[data-ko-id="${rowBefore}"] .thread-toggle`).isVisible(), true, "and the row you left is there")
  })

  await withPage({ viewport: { width: 700, height: 900 } }, async (page) => {
    await go(page, "/works/")
    const toggle = page.locator(".thread-toggle").first()
    await toggle.focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector(".thread-panel:popover-open"))
    await page.keyboard.press("ArrowDown")
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "A", "ArrowDown moves into the list")
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector(".thread-panel:popover-open"))
    assert.equal(await page.evaluate(() => document.activeElement.className), "thread-toggle", "and Escape returns to the name")
  })

  await withPage({}, async (page) => {
    await go(page, "/works/")
    const row = page.locator("li[data-ko-id]", { has: page.locator(".thread-toggle") }).first()
    await row.scrollIntoViewIfNeeded()
    assert.equal(await row.locator(".thread-toggle").evaluate((e) => getComputedStyle(e).opacity), "0", "absent at rest")
    await row.hover()
    await page.waitForFunction(() => [...document.querySelectorAll(".thread-toggle")].some((e) => getComputedStyle(e).opacity === "1"))
    await row.locator(".thread-toggle").hover()
    await page.waitForFunction(() => document.querySelector(".thread-panel:popover-open"))
  })
})

test("C-24.6-7 print output has defined semantics: a document, with its text, pictures and citations and none of the controls", { skip }, async () => {
  const pages = ["/works/", "/about/", ...(await internalPages()).slice(0, 4).map((o) => o.representations.find((r) => r.role === "page").href)]
  for (const colorScheme of ["light", "dark"]) {
    for (const path of pages) {
      await withPage({ viewport: { width: 794, height: 1123 }, colorScheme }, async (page) => {
        await go(page, path)
        await page.emulateMedia({ media: "print" })
        const state = await page.evaluate(() => ({
          bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color,
          overflow: document.documentElement.scrollWidth - innerWidth,
          chrome: [".kinds", ".masthead nav", ".footer", ".thread-reference", ".layer-toggles", ".work-back"].filter((s) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== "none"),
          images: [...document.images].filter((i) => i.getBoundingClientRect().width > innerWidth + 1).length,
        }))
        assert.equal(state.bg, "rgb(255, 255, 255)", `${path} (${colorScheme}): white paper`)
        assert.equal(state.ink, "rgb(0, 0, 0)", `${path} (${colorScheme}): black ink`)
        assert.equal(state.overflow, 0, `${path}: nothing runs off the page`)
        assert.deepEqual(state.chrome, [], `${path}: no controls on paper`)
        assert.equal(state.images, 0, `${path}: no picture wider than the page`)
        const pdf = await page.pdf({ format: "A4" })
        assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", `${path}: it makes a PDF`)
      })
    }
  }
  await withPage({ viewport: { width: 794, height: 1123 } }, async (page) => {
    await go(page, "/works/")
    await page.emulateMedia({ media: "print" })
    const all = await objects()
    const text = await page.evaluate(() => document.body.innerText)
    for (const o of all) assert.ok(text.includes(o.title.replace(/\u2019/g, "\u2019")), `"${o.title}" is on the printed Index`)
    assert.ok(await page.$$eval("li[data-ko-id] .month", (m) => m.every((x) => getComputedStyle(x).opacity === "1")), "every month shows")
    const external = all.filter((o) => o.representations.some((r) => r.role === "page" && r.href.startsWith("http")))
    assert.ok(external.length > 5)
    for (const o of external) {
      const href = o.representations.find((r) => r.role === "page").href
      const printed = await page.evaluate((id) => { const a = document.querySelector(`li[data-ko-id="${id}"] a[href^="http"]`); return a ? getComputedStyle(a, "::after").content : null }, o.id)
      assert.ok(printed && printed.includes(href), `${o.title}: its address is printed (${printed})`)
    }
  })
})

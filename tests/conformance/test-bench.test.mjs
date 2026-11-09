import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const base = process.env.SITE_URL
const repo = (process.env.SITE_REPO ?? process.cwd()).replace(/^~/, homedir())
const skip = base ? false : "set SITE_URL to run against a live site"
let browser
before(async () => { if (!skip) browser = await createRequire(join(repo, "package.json"))("playwright").chromium.launch({ channel: "chrome" }) })
after(async () => { await browser?.close() })

const STAND_IN = () => {
  const tools = new Map()
  window.__tools = tools
  Object.defineProperty(navigator, "modelContext", { configurable: true, value: {
    registerTool(t) { tools.set(t.name, t) },
    unregisterTool(n) { tools.delete(n) },
  } })
  window.__call = async (name, input) => {
    const t = tools.get(name)
    if (!t) throw new Error(`no tool ${name}`)
    return t.execute(input)
  }
}

async function room(fn, { standIn = true, viewport = { width: 1100, height: 1000 }, allow = [] } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", acceptDownloads: true })
  if (standIn) await context.addInitScript(STAND_IN)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  try {
    await page.goto(`${base}/test/`, { waitUntil: "networkidle" })
    await page.locator(".room-root[data-ready]").waitFor()
    if (standIn) await page.waitForFunction(() => window.__tools.has("room_list") && window.__tools.has("site_list_entries"))
    await fn(page, context)
    assert.deepEqual(errors.filter((e) => !allow.some((re) => re.test(e))), [], "no console errors or uncaught exceptions")
  } finally { await context.close() }
}
const reopen = async (page) => {
  await page.reload({ waitUntil: "networkidle" })
  await page.locator(".room-root[data-ready]").waitFor()
}
const call = (page, name, input = {}) => page.evaluate(([n, i]) => window.__call(n, i), [name, input])
const said = (r) => r.content[0].text
const latest = (page) => page.locator(".room-line .latest").innerText()
const settle = (page) => page.waitForTimeout(150)
const pieces = async (page) => (await call(page, "room_list")).structuredContent.pieces
const idOf = async (page, title) => (await pieces(page)).find((p) => p.title === title).id
const download = async (page, click) => {
  const [file] = await Promise.all([page.waitForEvent("download"), click()])
  return JSON.parse(await readFile(await file.path(), "utf8"))
}
const openPiece = async (page, id, title) => {
  await page.locator(`[data-piece="${id}"] .piece-title`).click()
  await page.locator("#room-piece-title", { hasText: title }).waitFor()
  await page.locator(".room-door .people").getByText(`At ${title}.`, { exact: true }).waitFor()
}
const siteTools = (page) => page.evaluate(() => [...window.__tools.keys()].filter((n) => n.startsWith("site_")))
const WHEN_ON_PAGE = { timeout: 8000 }

const controls = (page) => page.evaluate(() => {
  const out = {}
  const seen = new Map()
  for (const el of document.querySelectorAll(".room button, .room input, .room select, .room textarea, .room a, .room-line button")) {
    if (el.closest(".room-below .sheet.activity")) continue
    const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 50)
    const scope = el.closest("[data-piece-kept], [data-claim], [data-change], [data-piece]") ? "item" : el.closest("section")?.className || el.closest(".room-line")?.className || "room"
    if (scope === "item") continue
    const key = `${scope}|${label}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const r = el.getBoundingClientRect()
    const fixed = !!el.closest(".room-line")
    out[`${key}#${n}`] = [Math.round((r.left + (fixed ? 0 : scrollX)) * 2) / 2, Math.round((r.top + (fixed ? 0 : scrollY)) * 2) / 2]
  }
  return out
})
const unmoved = (before, after, what) => {
  const moved = Object.keys(before).filter((k) => k in after && (before[k][0] !== after[k][0] || before[k][1] !== after[k][1]))
  assert.deepEqual(moved.map((k) => `${k}: ${before[k]} -> ${after[k]}`), [], `controls moved after ${what}`)
}

test("T-1 the room is unlisted: noindex by header and meta, not in the sitemap, llms.txt or robots, and no test bench left on it", { skip }, async () => {
  const res = await fetch(`${base}/test/`)
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/)
  assert.match(res.headers.get("x-robots-tag") ?? "", /nofollow/)
  assert.equal(res.headers.get("cache-control"), "no-store")
  const html = await res.text()
  assert.match(html, /<meta name="robots" content="[^"]*noindex[^"]*"/)
  for (const path of ["/sitemap.xml", "/llms.txt", "/robots.txt"]) assert.ok(!(await (await fetch(base + path)).text()).includes("/test"), `${path} does not mention it`)
  for (const path of ["/", "/about/", "/works/"]) assert.ok(!(await (await fetch(base + path)).text()).includes('href="/test'), `${path} does not link to it`)
  assert.ok(!/Works<\/button>|Broken|How to test|Expect\./.test(html), "no test bench in the page as served")
  await room(async (page) => {
    const words = await page.locator(".room-root").innerText()
    for (const gone of ["Broken", "How to test", "Expect."]) assert.ok(!words.includes(gone), `"${gone}" is not on the page`)
    assert.equal(await page.getByRole("button", { name: "Works", exact: true }).count(), 0, "no Works mark")
  }, { standIn: false })
})

test("T-1 the read API and MCP, under 'From outside this browser', give the answers the API gives", { skip }, async () => {
  await room(async (page) => {
    const out = page.locator(".room-outside")
    const endpoint = out.getByLabel("Endpoint", { exact: true })
    const send = out.getByRole("button", { name: "Send", exact: true })
    await send.click()
    await out.getByText("identical to this page's own core").waitFor()
    assert.ok((await page.getByLabel("API response", { exact: true }).innerText()).length > 100, "the list is shown")
    await endpoint.selectOption("missing")
    await send.click()
    await out.getByText(/ 404, \d+ ms/).waitFor()
    await endpoint.selectOption("badlimit")
    await send.click()
    await out.getByText(/ 400, \d+ ms/).waitFor()

    const reply = page.getByLabel("MCP response", { exact: true })
    const post = out.getByRole("button", { name: /POST to \/api\/v1\/mcp\// })
    await out.getByRole("button", { name: "tools/list", exact: true }).click()
    await post.click()
    await reply.getByText('"ko_search_objects"').first().waitFor()
    assert.ok(!(await reply.innerText()).includes("ko_publish_collection"), "no write tool is offered")
    await out.getByRole("button", { name: "a write tool (refused)", exact: true }).click()
    await post.click()
    await reply.getByText("Unknown tool").waitFor()
    await out.getByRole("button", { name: "bad arguments", exact: true }).click()
    await post.click()
    await reply.getByText('"isError": true').waitFor()
    await out.getByRole("button", { name: "not JSON", exact: true }).click()
    await post.click()
    await reply.getByText("Parse error").waitFor()
  }, { standIn: false, allow: [/Failed to load resource: the server responded with a status of (400|404)/] })
})

test("T-1 the agent's tools: the 13 room tools beside the site's, reads marked read only, gone when you leave or press Stop", { skip }, async () => {
  const names = ["room_list", "room_read", "room_go", "room_go_back", "room_keep", "room_note", "room_claim", "room_cite", "room_propose_change", "room_approve", "room_take_step", "room_hand_back", "room_read_activity"]
  await room(async (page) => {
    const tools = await page.evaluate(() => [...window.__tools.values()].filter((t) => t.name.startsWith("room_")).map((t) => ({ name: t.name, readOnly: t.annotations.readOnlyHint })))
    assert.deepEqual(tools.map((t) => t.name).sort(), [...names].sort(), "exactly the 13 room tools")
    assert.ok((await siteTools(page)).length > 0, "the site's own tools are registered beside them")
    assert.deepEqual(tools.filter((t) => t.readOnly === true).map((t) => t.name).sort(), ["room_list", "room_read", "room_read_activity"], "readOnlyHint only on the three reads")
    assert.ok(tools.filter((t) => !["room_list", "room_read", "room_read_activity"].includes(t.name)).every((t) => t.readOnly === false))
    await page.locator(".masthead a", { hasText: "Rohan Khanna" }).click()
    await page.waitForURL((u) => u.pathname === "/")
    await page.waitForFunction(() => ![...window.__tools.keys()].some((n) => n.startsWith("room_")))
    assert.ok((await siteTools(page)).length > 0, "the site's tools are untouched")
  })
  await room(async (page) => {
    await page.getByRole("button", { name: "Stop its tools" }).click()
    assert.equal(await page.evaluate(() => window.__tools.size), 0, "every tool is gone, the site's too")
    assert.match(await page.locator(".room-door .people").innerText(), /Its tools are off for this visit\./)
    await reopen(page)
    await page.waitForTimeout(600)
    assert.equal(await page.evaluate(() => window.__tools.size), 0, "and still gone after a reload")
  })
})

test("T-1 authority: the agent cannot approve, and a toggled-off leave refuses its next proposal", { skip }, async () => {
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    await openPiece(page, g, "Gropius House")
    const proposed = await call(page, "room_propose_change", { id: g, field: "title", value: "Gropius House, Lincoln" })
    assert.ok(!proposed.isError, said(proposed))
    await page.locator(".room-line .waiting").waitFor()
    const refused = await call(page, "room_approve", { proposal: proposed.structuredContent.proposal })
    assert.equal(refused.isError, true)
    assert.match(said(refused), /never an agent/)
    await settle(page)
    assert.match(await latest(page), /Only you can approve/)
    assert.equal(await page.locator(".room-line .waiting").count(), 1, "the proposal is still waiting for you")
    assert.equal(await page.locator(".changes [data-change]").count(), 0, "nothing was settled")
    assert.equal((await pieces(page)).find((p) => p.id === g).title, "Gropius House", "nothing changed")

    const toggle = page.locator(".leave").getByRole("button", { name: "propose changes" })
    await toggle.click()
    await page.waitForFunction(() => document.querySelector(".leave button[aria-pressed=false]"))
    assert.equal(await toggle.getAttribute("aria-pressed"), "false")
    const second = await call(page, "room_propose_change", { id: g, field: "summary", value: "A house in Lincoln." })
    assert.equal(second.isError, true)
    await settle(page)
    assert.match(await latest(page), /it has no leave to propose changes/)
  })
})

test("T-1 approval is bound to the change: made, with its receipt and commit; declined, nothing changed; overtaken, set aside", { skip }, async () => {
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    await openPiece(page, g, "Gropius House")
    const waiting = page.locator(".room-line .waiting")
    const first = await call(page, "room_propose_change", { id: g, field: "title", value: "The Gropius House, Lincoln" })
    assert.ok(!first.isError, said(first))
    await waiting.waitFor()
    assert.match(await waiting.innerText(), /As the agent proposes: The Gropius House, Lincoln/)
    await page.locator(".room-line").getByRole("button", { name: "Approve", exact: true }).click()
    await page.locator(".changes [data-change=approved]").waitFor(WHEN_ON_PAGE)
    assert.match(await page.locator(".changes [data-change=approved]").innerText(), /Made by the agent for you, approved by you/)
    assert.equal(await page.locator("#room-piece-title").innerText(), "The Gropius House, Lincoln", "it was made")
    await page.locator(".changes").getByRole("button", { name: "As a commit" }).click()
    assert.match(await page.getByLabel("The commit this would be").innerText(), /KO-Approval: /)

    const declined = await call(page, "room_propose_change", { id: g, field: "summary", value: "A house in Lincoln, Massachusetts." })
    assert.ok(!declined.isError, said(declined))
    await waiting.waitFor()
    await page.locator(".room-line").getByRole("button", { name: "Decline", exact: true }).click()
    await page.locator(".changes [data-change=declined]").waitFor(WHEN_ON_PAGE)
    assert.match(await page.locator(".changes [data-change=declined]").innerText(), /Nothing changed/)
    assert.equal(await waiting.count(), 0)
  })
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    await openPiece(page, g, "Gropius House")
    const a = await call(page, "room_propose_change", { id: g, field: "title", value: "First title" })
    const b = await call(page, "room_propose_change", { id: g, field: "title", value: "Second title" })
    assert.ok(!a.isError && !b.isError, said(a) + said(b))
    await page.locator(".room-line").getByRole("button", { name: "Approve", exact: true }).click()
    await page.locator(".changes [data-change=approved]").waitFor(WHEN_ON_PAGE)
    const aside = page.locator(".changes [data-change]", { hasText: "Set aside" })
    await aside.waitFor(WHEN_ON_PAGE)
    await page.locator(".room-line .waiting").waitFor({ state: "detached" })
    assert.match(await aside.innerText(), /Set aside: .* changed after this was proposed\./, "it says why")
    assert.match(await page.locator(".room-activity").innerText(), /was set aside: the piece changed after it was proposed\./, "and says so in the activity")
    assert.match(await aside.innerText(), /No receipt: nothing was made\./)
    assert.equal(await page.locator("#room-piece-title").innerText(), "First title", "the second was not made")
  })
})

test("T-1 kept, notes and claims: a line under a kept piece, a region note exported as W3C, a claim that takes no number", { skip }, async () => {
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    await page.locator(`[data-piece="${g}"] .piece-title`).click()
    await page.locator("#room-piece-title", { hasText: "Gropius House" }).waitFor()

    const kept = await call(page, "room_keep", { id: g, line: "The module shows in the doorframes." })
    assert.ok(!kept.isError, said(kept))
    await page.getByLabel("Line under Gropius House", { exact: true }).waitFor()
    assert.equal(await page.getByLabel("Line under Gropius House", { exact: true }).inputValue(), "The module shows in the doorframes.")
    const exported = await download(page, () => page.locator(".room-kept").getByRole("button", { name: "Export", exact: true }).click())
    const text = JSON.stringify(exported)
    assert.match(text, /"state":"current"/, "the export says the reference is current")
    assert.match(text, /The module shows in the doorframes\./, "and carries the line")

    const noted = await call(page, "room_note", { id: g, text: "The stair, on the module.", region: { x: 20, y: 25, w: 30, h: 40 } })
    assert.ok(!noted.isError, said(noted))
    await page.locator(".picture .region").first().waitFor()
    assert.equal(await page.locator(".picture .region").count(), 1)
    const notes = await download(page, () => page.getByRole("button", { name: "Export every note", exact: true }).click())
    assert.equal(notes.type, "AnnotationCollection")
    assert.equal(notes.items.length, 1)
    const note = JSON.stringify(notes.items[0])
    assert.match(note, /xywh=percent:/)
    assert.match(note, /"type":"Software"/, "the creator is software")
    assert.match(note, /"ko:onBehalfOf":"urn:khannaoffice:participant:you"/, "on behalf of you")

    const claim = await call(page, "room_claim", { about: g, statement: "The plan is drawn on a module." })
    assert.ok(!claim.isError, said(claim))
    const id = claim.structuredContent.claim
    const cited = await call(page, "room_cite", { claim: id, source: g, relation: "supports" })
    assert.match(said(cited), /supported by one source/)
    await page.locator(".claims").getByText(/supported by one source/).first().waitFor()
    const madeUp = await call(page, "room_cite", { claim: id, source: "ko-doesnotexist", relation: "supports" })
    assert.equal(madeUp.isError, true)
    assert.match(said(madeUp), /No piece has the id "ko-doesnotexist"/)
    await page.locator(".claims").getByText(/supported by one source/).first().waitFor()
    const numbered = await call(page, "room_cite", { claim: id, source: g, relation: "supports", confidence: 0.9 })
    assert.equal(numbered.isError, true)
    assert.match(said(numbered), /no number/i)
    const inClaim = await call(page, "room_claim", { about: g, statement: "Something.", confidence: 0.5 })
    assert.equal(inClaim.isError, true)
  })
})

test("T-1 position and return: the open piece survives a reload, and room_go_back returns the agent to where it was", { skip }, async () => {
  await room(async (page) => {
    const all = await pieces(page)
    const [a, b, c] = [all[3], all[7], all[11]]
    await openPiece(page, b.id, b.title)
    await reopen(page)
    await page.locator("#room-piece-title", { hasText: b.title }).waitFor()
    assert.match(await page.locator(".room-door .people").innerText(), new RegExp(`At ${b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`), "the door says where you are")

    await page.waitForFunction(() => window.__tools.has("room_go"))
    assert.ok(!(await call(page, "room_go", { id: a.id })).isError)
    assert.ok(!(await call(page, "room_go", { id: c.id })).isError)
    const back = await call(page, "room_go_back")
    assert.ok(!back.isError, said(back))
    assert.match(said(back), /^Back: The material, item \d+ of 36\./)
    assert.equal(back.structuredContent.at, a.id, "it lands exactly where it was")
    assert.match(await page.locator("#room-piece-title").innerText(), new RegExp(b.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  })
})

test("T-1 handoff: work set out is handed over, the agent takes a step and hands it back with its line, step 2 in front of you", { skip }, async () => {
  await room(async (page) => {
    await page.getByLabel("What the work is").fill("Check the Gropius pictures")
    await page.getByLabel("Step 1", { exact: true }).fill("Look at the stair")
    await page.getByLabel("Step 2", { exact: true }).fill("Write it up")
    await page.getByRole("button", { name: "Set it out", exact: true }).click()
    await page.getByRole("button", { name: "Hand it over as it is" }).click()
    await page.locator(".room-work .status", { hasText: "With the agent" }).waitFor()
    const taken = await call(page, "room_take_step")
    assert.ok(!taken.isError, said(taken))
    assert.match(said(taken), /Step 1 of 2 is in front of you: Look at the stair/)
    const back = await call(page, "room_hand_back", { done: true, line: "The stair is in plate 4." })
    assert.ok(!back.isError, said(back))
    await page.locator(".room-work .status", { hasText: "Back with you" }).waitFor()
    assert.match(await page.locator(".room-work .status").innerText(), /Back with you, step 2 in front of you\. Its line: The stair is in plate 4\./)
    assert.match(await page.locator(".room-work .steps li[data-front]").innerText(), /Write it up/)
    assert.equal(await page.locator(".room-work .steps li[data-front]").count(), 1, "one step in front, and it is step 2")
  })
})

test("T-1 everything is kept in this browser across a reload, and 'Start the room over' empties it", { skip }, async () => {
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    await page.locator(`[data-piece="${g}"] .piece-title`).click()
    await page.locator("#room-piece-title", { hasText: "Gropius House" }).waitFor()
    await call(page, "room_keep", { id: g, line: "Kept for the reload." })
    await call(page, "room_note", { id: g, text: "A note for the reload." })
    const claim = await call(page, "room_claim", { about: g, statement: "A claim for the reload." })
    await call(page, "room_cite", { claim: claim.structuredContent.claim, source: g, relation: "supports" })
    await page.getByLabel("What the work is").fill("Work for the reload")
    await page.getByLabel("Step 1", { exact: true }).fill("Only step")
    await page.getByRole("button", { name: "Set it out", exact: true }).click()
    await page.locator(".room-work .status").waitFor()

    await reopen(page)
    await page.waitForFunction(() => window.__tools.has("room_list"))
    assert.equal(await page.getByLabel("Line under Gropius House", { exact: true }).inputValue(), "Kept for the reload.")
    assert.match(await page.locator(".notes").innerText(), /A note for the reload\./)
    assert.match(await page.locator(".claims").innerText(), /A claim for the reload\./)
    assert.match(await page.locator(".room-work").innerText(), /Work for the reload/)
    assert.match(await page.locator(".room-activity").innerText(), /The agent kept Gropius House, with a line\./)

    await page.getByRole("button", { name: "Start the room over" }).click()
    await page.getByRole("button", { name: "Keep it", exact: true }).click()
    assert.equal(await page.getByLabel("Line under Gropius House", { exact: true }).count(), 1, "'Keep it' keeps it")
    await page.getByRole("button", { name: "Start the room over" }).click()
    await page.getByRole("button", { name: "Start over", exact: true }).click()
    await page.getByLabel("Line under Gropius House", { exact: true }).waitFor({ state: "detached" })
    await page.locator(".room-kept").getByText("nothing yet").waitFor()
    assert.equal(await page.locator(".notes [data-piece], .notes li:not(.quiet)").count(), 0, "no notes")
    await page.locator(".claims").getByText("None yet").waitFor()
    await page.getByLabel("What the work is").waitFor()
    assert.equal(await page.locator(".room-activity li").count(), 1)
    assert.match(await page.locator(".room-activity").innerText(), /Nothing yet\./)
    await reopen(page)
    await page.locator(".room-kept").getByText("nothing yet").waitFor()
    await page.locator(".claims").getByText("None yet").waitFor()
  })
})

for (const [width, height] of [[1100, 1000], [390, 844]]) {
  test(`T-1 things stay put: no control moves after anything the agent does, at ${width} wide`, { skip }, async () => {
    await room(async (page) => {
      const list = await pieces(page)
      const g = list.find((p) => p.title === "Gropius House").id
      await page.locator(`[data-piece="${g}"] .piece-title`).click()
      await page.locator("#room-piece-title", { hasText: "Gropius House" }).waitFor()
      await page.evaluate(() => scrollTo(0, 0))
      await settle(page)
      const before = await controls(page)
      assert.ok(Object.keys(before).length > 30, "controls were measured")
      const still = async (what) => { await settle(page); unmoved(before, await controls(page), what) }

      await call(page, "room_list"); await still("it looked over the material")
      await call(page, "room_read", { id: g }); await still("it read a piece")
      await call(page, "room_go", { id: list[5].id }); await still("it went to another piece")
      await call(page, "room_go_back"); await still("it went back")
      await call(page, "room_keep", { id: g, line: "A line." }); await still("it kept a piece")
      await call(page, "room_note", { id: g, text: "A note." }); await still("it wrote a note")
      await call(page, "room_note", { id: g, text: "On a region.", region: { x: 10, y: 10, w: 20, h: 20 } }); await still("it marked a region")
      const claim = await call(page, "room_claim", { about: g, statement: "A claim." }); await still("it stated a claim")
      await call(page, "room_cite", { claim: claim.structuredContent.claim, source: g, relation: "supports" }); await still("it cited a source")
      const proposed = await call(page, "room_propose_change", { id: g, field: "date", value: "2025-10-13" }); await still("it proposed a change")
      const approveAt = (await controls(page))["room-line|Approve#0"]
      assert.ok(approveAt, "Approve is on the running line")
      await call(page, "room_approve", { proposal: proposed.structuredContent.proposal }); await still("it tried to approve")
      await page.locator(".room-line").getByRole("button", { name: "Decline", exact: true }).click()
      await page.locator(".room-line .waiting").waitFor({ state: "detached" })
      await call(page, "room_propose_change", { id: list[2].id, field: "summary", value: "A second line waiting." })
      await page.locator(".room-line .waiting").waitFor()
      assert.deepEqual((await controls(page))["room-line|Approve#0"], approveAt, "Approve holds its place from one proposal to the next")
      await call(page, "room_read_activity", {}); await still("it read the activity")
      const box = await page.locator(".room-line").getByRole("button", { name: "Approve", exact: true }).boundingBox()
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, "Approve is in the window")
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, "no sideways scroll")

      await page.locator(".room-line").getByRole("button", { name: "Decline", exact: true }).click()
      await page.getByLabel("What the work is").fill("Check the pictures")
      await page.getByLabel("Step 1", { exact: true }).fill("Look")
      await page.getByLabel("Step 2", { exact: true }).fill("Write")
      await page.getByRole("button", { name: "Set it out", exact: true }).click()
      await page.getByRole("button", { name: "Hand it over as it is" }).waitFor()
      await page.evaluate(() => scrollTo(0, 0))
      await settle(page)
      const working = await controls(page)
      await page.getByRole("button", { name: "Hand it over as it is" }).click()
      await call(page, "room_take_step")
      await call(page, "room_hand_back", { done: true, line: "Done." })
      await page.locator(".room-work .status", { hasText: "Back with you" }).waitFor()
      await settle(page)
      unmoved(working, await controls(page), "the work went to the agent and back")
    }, { viewport: { width, height } })
  })
}

const LONG = "A house in Lincoln, Massachusetts, built in 1938 by Walter Gropius for his family, " + "drawn on a module that shows in the doorframes, the stair and the glass block wall, ".repeat(10) + "and this is the end of the proposal."
const approve = (page) => page.locator(".room-line").getByRole("button", { name: "Approve", exact: true })

test("T-1 a long proposal is shown whole, and Approve waits until it has been read to its end", { skip }, async () => {
  await room(async (page) => {
    const g = await idOf(page, "Gropius House")
    assert.ok(!(await call(page, "room_propose_change", { id: g, field: "summary", value: LONG })).isError)
    const region = page.locator(".room-line .waiting")
    await region.waitFor()
    assert.ok((await region.innerText()).includes("and this is the end of the proposal."), "the whole proposal is on the line")
    assert.equal(await region.evaluate((el) => [...el.querySelectorAll("p")].filter((p) => p.scrollHeight > p.clientHeight + 1).length), 0, "no part of it is clipped")
    assert.ok(await region.evaluate((el) => el.scrollHeight > el.clientHeight + 2), "on a phone it scrolls")
    await page.waitForTimeout(800)
    assert.equal(await approve(page).isDisabled(), true, "Approve waits")
    assert.match(await page.locator(".room-line .ask").innerText(), /Read it to the end to approve/)
    await approve(page).click({ force: true }).catch(() => {})
    await settle(page)
    assert.equal(await page.locator(".changes [data-change]").count(), 0, "nothing approved unread")
    await region.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await approve(page).click()
    await page.locator(".changes [data-change=approved]").waitFor(WHEN_ON_PAGE)
  }, { viewport: { width: 390, height: 844 } })
})

test("T-1 Approve pressed twice approves one proposal; focus does not pass to the next one's Approve", { skip }, async () => {
  await room(async (page) => {
    const list = await pieces(page)
    await call(page, "room_propose_change", { id: list[0].id, field: "title", value: "One" })
    await call(page, "room_propose_change", { id: list[1].id, field: "title", value: "Two" })
    await page.locator(".room-line .waiting").waitFor()
    await page.waitForFunction(() => !document.querySelector(".room-line .ask button")?.disabled)
    const box = await approve(page).boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(120)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)
    assert.equal(await page.locator(".changes [data-change=approved]").count(), 1, "one approved")
    assert.equal(await page.locator(".room-line .waiting").count(), 1, "the other still waits")
    assert.equal(await page.evaluate(() => document.activeElement?.textContent === "Approve"), false, "focus is not on the next Approve")
  })
})

test("T-1 one Stop: the site's own Stop, on the masthead, takes the room's tools away too", { skip }, async () => {
  await room(async (page) => {
    let link
    for (const e of (await call(page, "site_list_entries")).structuredContent.entries) {
      const l = (await call(page, "site_read_entry", { id: e.id })).structuredContent.links.find((x) => /^https?:/.test(x.href))
      if (l) { link = { id: e.id, label: l.label }; break }
    }
    const asked = call(page, "site_open_link", link)
    await page.locator(".agent-line").getByRole("button", { name: "Not now" }).click()
    await asked
    await page.locator(".agent-line").getByRole("button", { name: "Stop" }).click()
    assert.equal(await page.evaluate(() => [...window.__tools.keys()].filter((n) => n.startsWith("room_")).length), 0, "no room tools left")
    assert.match(await page.locator(".room-door .people").innerText(), /Its tools are off for this visit\./)
  })
})

test("T-1 nothing moves when proposals and kept pieces arrive: Approve with a second waiting, and the kept rows under your pointer", { skip }, async () => {
  await room(async (page) => {
    const list = await pieces(page)
    await call(page, "room_propose_change", { id: list[0].id, field: "title", value: "One" })
    await page.locator(".room-line .waiting").waitFor()
    await settle(page)
    const at = (await controls(page))["room-line|Approve#0"]
    await call(page, "room_propose_change", { id: list[1].id, field: "title", value: "Two" })
    await page.locator(".room-line .waiting", { hasText: "1 of 2 waiting." }).waitFor()
    assert.deepEqual((await controls(page))["room-line|Approve#0"], at, "Approve did not move when a second arrived")
    await call(page, "room_keep", { id: list[2].id })
    await call(page, "room_keep", { id: list[3].id })
    await page.locator(".kept > li").nth(1).waitFor()
    const rows = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".kept [data-piece-kept] button")].map((b) => [`${b.closest("[data-piece-kept]").dataset.pieceKept}|${b.textContent}`, Math.round(b.getBoundingClientRect().top + scrollY)])))
    await page.locator(".kept > li").nth(1).getByRole("button", { name: /up/i }).hover()
    const before = await rows()
    await call(page, "room_keep", { id: list[4].id, at: 1 })
    await settle(page)
    const after = await rows()
    assert.deepEqual(Object.keys(before).filter((k) => before[k] !== after[k]), [], "the rows under your pointer held still")
    assert.match(await latest(page), /The agent's order waits until you leave the list\./)
    await page.mouse.move(5, 5)
    await page.waitForFunction((first) => document.querySelector(".kept [data-piece-kept]")?.dataset.pieceKept === first, list[4].id)
  })
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { emptyPositions, follow, positionFromQuery, positionToQuery, restorePosition, setPosition, unfollow, viewOf, type Position } from "../src/position.ts"

const surface = { surfaceId: "index", revisionId: "r2", anchors: ["a", "b", "c", "d"] }

test("restoration tries the anchor, then the nearest that remains, then reports its fallback", () => {
  const at: Position = { surfaceId: "index", anchor: "c", nearby: ["b", "d", "a"], revisionId: "r2" }
  assert.deepEqual(restorePosition(at, surface), { resolution: "exact", anchor: "c", revisionChanged: false })
  const gone = { ...at, anchor: "x", nearby: ["y", "d", "a"] }
  assert.deepEqual(restorePosition(gone, surface), { resolution: "nearby", anchor: "d", requested: "x", revisionChanged: false })
})

test("C-24.3-4 failed anchor restoration reports an explicit fallback, never a silent landing", () => {
  const lost = restorePosition({ surfaceId: "index", anchor: "x", nearby: ["y", "z"] }, surface)
  assert.equal(lost.resolution, "fallback")
  assert.equal(lost.resolution === "fallback" && lost.reason, "anchor-gone")
  assert.equal(lost.resolution === "fallback" && lost.requested, "x", "it says what it was asked for")
  const elsewhere = restorePosition({ surfaceId: "other", anchor: "a" }, surface)
  assert.equal(elsewhere.resolution === "fallback" && elsewhere.reason, "surface-differs")
  assert.equal(restorePosition({ surfaceId: "index", anchor: "a", revisionId: "r1" }, surface).revisionChanged, true, "a changed revision is reported")
  assert.equal(restorePosition({ surfaceId: "index" }, surface).resolution, "exact", "no anchor asked, nothing to miss")
})

test("C-24.3-5 agent navigation cannot seize the human's position", () => {
  let state = emptyPositions()
  state = setPosition(state, "human", { surfaceId: "index", anchor: "a" })
  state = setPosition(state, "agent", { surfaceId: "index", anchor: "d" })
  assert.equal(viewOf(state, "human")?.anchor, "a", "the agent moved; the human did not")
  state = setPosition(state, "agent", { surfaceId: "paper", anchor: "intro" })
  assert.equal(viewOf(state, "human")?.anchor, "a")
  assert.equal(viewOf(state, "human")?.surfaceId, "index")

  const followed = follow(state, "human", "agent")
  assert.equal(viewOf(followed, "human")?.surfaceId, "paper")
  assert.equal(viewOf(followed, "agent")?.surfaceId, "paper")
  assert.equal(viewOf(unfollow(followed, "human"), "human")?.anchor, "a", "ending a follow returns you to your own place")
  assert.deepEqual(state.following, {}, "an agent has no operation that makes a human follow it")
})

test("an address carries where, and never what the reader selected or noted", () => {
  const position: Position = {
    surfaceId: "paper", anchor: "figure-3", offset: 12, revisionId: "r9",
    selection: { anchor: "figure-3", start: 4, end: 40 },
    viewState: { privateNote: "call them back", draft: true },
  }
  const query = positionToQuery(position)
  assert.equal(query, "at=figure-3&offset=12&revision=r9")
  for (const secret of ["call", "draft", "selection", "start"]) assert.ok(!query.includes(secret), `leaks ${secret}`)
  assert.deepEqual(positionFromQuery("paper", query), { surfaceId: "paper", anchor: "figure-3", offset: 12, revisionId: "r9" })
  assert.deepEqual(positionFromQuery("paper", "offset=NaN"), { surfaceId: "paper" }, "a garbled address is not a position")
})

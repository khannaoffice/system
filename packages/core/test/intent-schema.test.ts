import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultAdapters, newSession, stepSession, type Input, type Intent } from "../src/intent.ts"
import { Ajv2020, read } from "./helpers.ts"

const ajv = new Ajv2020({ strict: true, allErrors: true })
ajv.addSchema(read("schemas/intent.schema.json"))
const check = ajv.getSchema("urn:khannaoffice:system:v1:schema:intent")!

const box = { left: 100, top: 100, right: 200, bottom: 140 }
const inputs: [Input, number][] = [
  [{ mode: "pointer", type: "move", x: 20, y: 120 }, 1000],
  [{ mode: "pointer", type: "move", x: 70, y: 120 }, 1016],
  [{ mode: "pointer", type: "frame", targets: [{ id: "a", box }] }, 1016],
  [{ mode: "pen", type: "move", x: 150, y: 120, height: 0.3 }, 2000],
  [{ mode: "pen", type: "frame", targets: [{ id: "a", box }] }, 2016],
  [{ mode: "touch", type: "down", target: "a" }, 3000],
  [{ mode: "touch", type: "up", target: "a" }, 3040],
  [{ mode: "keyboard", type: "focus", target: "a", order: ["a", "b"] }, 4000],
  [{ mode: "voice", type: "partial", transcript: "pro", labels: [{ id: "a", label: "Projects" }] }, 5000],
  [{ mode: "gaze", type: "gaze", x: 150, y: 120, targets: [{ id: "a", box }] }, 6000],
  [{ mode: "gaze", type: "gaze", x: 150, y: 120, targets: [{ id: "a", box }] }, 6400],
  [{ mode: "switch", type: "start", order: ["a", "b"] }, 7000],
  [{ mode: "switch", type: "tick" }, 7500],
]

test("the Intent schema compiles under Draft 2020-12 in strict mode", () => {
  assert.ok(check)
})

test("every Intent a scripted session through all seven adapters emits validates against the Intent schema", () => {
  const adapters = defaultAdapters()
  let s = newSession()
  const all: Intent[] = []
  for (const [input, now] of inputs) {
    const r = stepSession(adapters, s, input, now)
    s = r.session
    all.push(...r.intents)
  }
  assert.ok(all.length > 15)
  assert.ok(all.some((i) => i.certainty > 0 && i.certainty < 1), "the script produced fractional certainties too")
  for (const i of all) assert.ok(check(i), `${JSON.stringify(i)}: ${ajv.errorsText(check.errors)}`)
})

test("the Intent schema rejects what it should", () => {
  const bad = [
    { target: "a", certainty: 1.01 },
    { target: "a", certainty: -0.01 },
    { target: "a", certainty: NaN },
    { target: "a", certainty: "0.5" },
    { target: "a", certainty: 0.5, probability: 0.5 },
    { target: "", certainty: 0.5 },
    { certainty: 0.5 },
    { target: "a" },
  ]
  for (const b of bad) assert.equal(check(b), false, JSON.stringify(b))
  for (const g of [{ target: "a", certainty: 0 }, { target: "a", certainty: 1 }]) assert.ok(check(g))
})

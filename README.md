# KhannaOffice System

The KhannaOffice System is a grammar for information. It gives people and agents one way to meet information, find their way through it, interpret it, organise it and act on it. It covers identity, position, evidence, authority and change, independent of input method.

The System is useful with no AI model. An agent works through the same operations a person does, under authority a person gives and can take back.

This is version 0.1.0, proposed. The specification, the schemas, the reference packages and the conformance suite are all here.

## Yours to keep

The System needs no database, no hosted service and no account. What is published lives in Git as plain files. What is yours as a reader stays on your device, in the browser's IndexedDB or in a folder of files you can open in a text editor. Grants, approvals and receipts survive a restart in the same local store.

Publishing is an explicit, authorised operation. It makes one Git commit that carries its receipt, and it never pushes: sending a change anywhere is your own act. A test keeps the core free of network code, so you can install the System and own your whole information environment.

## What is here

| | |
|---|---|
| [`spec/SPEC.md`](spec/SPEC.md) | The foundational specification. |
| [`spec/STATUS.md`](spec/STATUS.md) | The authority of each section (Established, Proposed or Experimental) and the phase that builds it. |
| [`spec/STORAGE.md`](spec/STORAGE.md) | The storage contracts: the store, the write-state log, and published work in Git. |
| [`spec/amendments/`](spec/amendments) | Amendment 0001, proposed against the specification: intent, cadence, Within and refusal. |
| [`packages/core/`](packages/core) | The System as pure functions with no dependencies. |
| [`packages/state/`](packages/state) | Personal state and write state, kept on your device. |
| [`packages/adapters/`](packages/adapters) | The Model Context Protocol, WebMCP and Git. |
| [`schemas/`](schemas) | Twenty JSON Schemas (Draft 2020-12) for the System's records. |
| [`fixtures/rohankhanna/`](fixtures/rohankhanna) | The register of rohankhanna.com, rebuilt from its public API, with the durations of its films and the sizes of its photographs. |
| [`tests/conformance/`](tests/conformance) | The registry of every requirement, and the suites that prove them. |
| [`scripts/`](scripts) | Rebuild the registry, copy the core into a site, and export a register from a running site. |

## Install

```sh
npm install @khannaoffice/system
```

Each module has its own entry point, so you import what you use.

```ts
import { readFileSync } from "node:fs"
import { listObjects } from "@khannaoffice/system/core/core"
import { invoke } from "@khannaoffice/system/core/capabilities"

const register = JSON.parse(readFileSync("register.json", "utf8"))

const photographs = listObjects(register, { type: "Photograph", limit: 5 })
const found = invoke(register, { capability: "ko_search_objects", arguments: { query: "mcgill" } })
```

A register is plain data: objects, relations, collections and revisions. [`fixtures/rohankhanna/register.json`](fixtures/rohankhanna/register.json) is a real one. Every operation answers with `status: "ok"` and its data, or with `status: "failed"` and an error that names what happened.

| Import | What you get |
|---|---|
| `@khannaoffice/system/core/<module>` | One module of the core, such as `core`, `capabilities` or `intent`. |
| `@khannaoffice/system/state/<module>` | `store`, `filestore`, `personal` or `world-store`. |
| `@khannaoffice/system/adapters/mcp` | The Model Context Protocol handler. |
| `@khannaoffice/system/adapters/webmcp` | The browser adapter for WebMCP. |
| `@khannaoffice/system/adapters/git` | Publishing to a Git repository, from Node. |
| `@khannaoffice/system/adapters/git/render` | The same change as files and a commit message, with no filesystem. |
| `@khannaoffice/system/schemas/<name>.schema.json` | One JSON Schema. |

To keep the source in your own site, copy it there. The copy carries a header that names where each file came from, and `--check` exits with 1 when the copy has drifted.

```sh
node scripts/vendor.mjs <folder>
node scripts/vendor.mjs <folder> --check
```

## The modules

The core is pure: it reads no clock, no network and no page. Time and identifiers are passed in, so every rule can be tested where it stands.

| Core | |
|---|---|
| `core` | The register: objects, relations, collections, and the reads on them. |
| `capabilities` | The operations a participant can perform, declared once and performed through one entry point, `invoke`. |
| `operations` | Every write. Authority is checked at the boundary, approval is bound to the exact inputs, and each outcome leaves a receipt. |
| `authority` | Who may do what, as a pure function of the participant, their grants, the capability, the resource and the time. |
| `task` | The unit of work a person hands to an agent, with its states and its handoffs. |
| `position` | Where a participant is on a surface, and how that is kept, restored and shared. |
| `surface` | Document, index, sequence, film, image and map. Each says where a saved position lands now, and says it in words. |
| `gather` | A reader's own collection: references in the order they choose, with notes, private by default. |
| `annotation` | Notes, exported in the W3C Web Annotation Data Model. |
| `warrant` | Claims and what they rest on. A warrant carries its status in words and no confidence number. |
| `jsonld` | JSON-LD for objects: Schema.org where it says the thing, and a `ko:` vocabulary for the rest. |
| `intent` | One adapter for each input mode: pointer, pen, touch, keyboard, voice, gaze and switch. Each turns plain events into intents and named operations. |
| `reading` | How surely the pointer is heading for a target, as a number from 0 to 1. |
| `cadence` | One base unit of time for a site, with every duration a whole multiple of it, and rest and reduced motion as functions. |
| `within` | The smallest set of moves between two states of a list, computed from identities, with the change said in words. |
| `refusal` | Placement on the Unigrid lattice. It returns a whole-module placement or a refusal that names the rule. |
| `label` | One label for a published object, rendered to the page, the record and print from the same words. |
| `maker` | The conformance rules that bear on a draft, answered in a maker's words at the moment of the mistake. |

| State | |
|---|---|
| `store` | A small key-value store, in memory or in IndexedDB. |
| `filestore` | The same store as a folder of readable JSON files, written so that a crash leaves the old value or the new one. |
| `personal` | A reader's gathers and last positions, in whichever store you give it. |
| `world-store` | Grants, approvals, receipts, tasks and the audit log, kept in any store. A crash between the log and the state is detected and reported as `unknown`. |

| Adapters | |
|---|---|
| `mcp` | The Model Context Protocol as a pure JSON-RPC handler. Your host supplies the transport, and every call goes through `invoke`. |
| `webmcp` | Experimental. It registers the capabilities with a browser that offers WebMCP, behind feature detection. |
| `git` | Writes a committed change as plain JSON files and commits it with its receipt in the message. It never pushes. |

## Run the tests

The tests run TypeScript directly, so they need Node 22.18 or later.

```sh
npm install
npm test
npm run typecheck
npm run build
npm run registry
```

`npm test` is the gate: the specification's own accounting, the core, state, the adapters, the schemas and the scan for network code. Of its 258 tests, 224 run on their own and 34 wait for a site. Read the result from the exit code.

`npm run registry` rebuilds the requirement registry after a change to section 24 of the specification or to amendment 0001. A requirement is marked passing only when a test file that names it exists.

The remaining suites drive a running site that has adopted the System. `SITE_URL` is its address. `SITE_REPO` is a folder with Playwright installed, and the browser suites use Chrome.

```sh
SITE_URL=http://localhost:3000 SITE_REPO=<folder> npm run test:protocols
SITE_URL=http://localhost:3000 SITE_REPO=<folder> npm run test:parity
SITE_URL=http://localhost:3000 SITE_REPO=<folder> npm run test:browser
SITE_URL=http://localhost:3000 SITE_REPO=<folder> npm run test:bench
```

| Suite | What it proves |
|---|---|
| `test:protocols` | The same read means the same thing through HTTP, the Model Context Protocol and WebMCP. |
| `test:parity` | The Index shows what the API returns, in the same order. |
| `test:browser` | Positions, geometry, layout shift, the keyboard, touch and print. |
| `test:bench` | A working room where a person and an agent share one register, driven as both. |

## Licence

Copyright 2026 Rohan Khanna, carrying on business as KhannaOffice. All rights reserved.

A licence for the System has not been chosen yet. You are welcome to read the specification and the code. For any other use, write to hello@khannaoffice.com.

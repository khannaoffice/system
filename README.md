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
| [`packages/web/`](packages/web) | Approach and Whereabouts: the pointer's reading on each link, and moves between pages. |
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
| `@khannaoffice/system/web/approach` | Which link the pointer is going for, as `--near` on each one. |
| `@khannaoffice/system/web/whereabouts` | Moves between pages, on View Transitions. |
| `@khannaoffice/system/web/whereabouts.css` | The moves themselves, for you to tune. |
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

## On the page

The core is pure, so it never touches a page. The web part does, and it is small: two modules that bring the core's reading and its idea of place to a site.

### Approach

Approach watches the pointer and gives every target one number, `--near`, from 0 to 1. Your stylesheet decides what it means: an underline that darkens, a reflection that firms up, a shadow that lifts.

```js
import { approach } from "@khannaoffice/system/web/approach"

const stop = approach({ selector: "nav a" })
```

```css
nav a {
  --near: 0;
  text-decoration-color: color-mix(in srgb, currentColor calc(var(--near) * 100%), transparent);
}
```

- **Ahead.** Every link is read a moment ahead of the pointer, so the link the hand is going for answers before it arrives.
- **Near.** Closeness is measured to a link's edge, so a long link answers as readily as a short one.
- **Between.** Neighbours share the pointer. Halfway between two links, they split it.
- **Settle.** Every answer eases in and out, a little slower to leave than to arrive, so an unsteady hand never makes it flicker.

The reading is the core's pointer adapter, the same numbers in every place it runs. Approach sleeps when nothing moves. A pen reads as the pointer, and a finger has no approach, so touch lets go of whatever the pointer was lighting. `approach()` takes `selector`, `radius` (72 pixels from a target's edge) and `onFrame`, and returns a function that stops reading and clears every `--near`.

### Whereabouts

Along, into, within: three ways of moving through pages, and in each you keep your whereabouts.

- **Along.** Pages sit side by side on one surface. Going forward slides it left, going back slides it right, and whatever both pages share, a masthead say, holds still.
- **Into.** A page can sit inside another, as a piece inside its list. Opening it zooms in on the link it came from, and its title travels with you. Leaving zooms back out onto the same place.
- **Within.** Inside a page, only what changes moves. That is the core's `within`.

```js
import { move, onHistory } from "@khannaoffice/system/web/whereabouts"
import "@khannaoffice/system/web/whereabouts.css"

const PLACES = ["/", "/about/", "/works/"]

const site = {
  position: (path) => (PLACES.includes(path) ? PLACES.indexOf(path) : PLACES.length),
  parent: (path) => (path.startsWith("/works/") && path !== "/works/" ? "/works/" : null),
  focus: (from, to) => document.querySelector(`[href="${to}"]`) ?? document.querySelector("h1"),
  travellers: (from, to) => document.querySelectorAll(`[data-piece="${to}"], [data-piece="${from}"]`),
}

move(site, location.pathname, href, () => render(href))

onHistory(site, () => currentPath, render)
```

It is built on the web's own View Transitions, around whatever navigation a site already has, so links, the address bar and the back button work as they always have. Touch anything mid-move and it finishes at once. Where the browser has no View Transitions, or the reader prefers less motion, the page changes without a move.

| The site | |
|---|---|
| `position(path)` | Where a path sits along the surface. Paths at the same place do not move. |
| `parent(path)` | The path it sits inside, if any. Moving between the two zooms. |
| `focus(from, to)` | The element a zoom centres on: the link followed, or the title left. |
| `travellers(from, to)` | The elements that travel on their own during a zoom, such as a piece's title. |
| `here()` | The path the address bar shows. Defaults to `location.pathname`. |
| `ready(path)` | Resolves once that page is in the document, for routers that render after they are asked. |

`onHistory` makes the back and forward buttons move too, and never twice: a swipe the browser already animates is left to the browser. With a router that renders from its own history listener, Next.js among them, leave out `update`. Whereabouts then holds the history event, captures the old page, and hands the event on.

The stylesheet holds the moves. Tune them with `--whereabouts-step`, `--whereabouts-slide`, `--whereabouts-zoom` and `--whereabouts-ease`. During a move, `<html>` carries `data-whereabouts` with the move's name, and each traveller carries `data-whereabouts-travelling`.

## Run the tests

The tests run TypeScript directly, so they need Node 22.18 or later.

```sh
npm install
npm test
npm run typecheck
npm run build
npm run registry
```

`npm test` is the gate: the specification's own accounting, the core, state, the adapters, the web part, the schemas and the scan for network code. Of its 276 tests, 242 run on their own and 34 wait for a site. Read the result from the exit code.

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

The KhannaOffice System is under the Apache License 2.0: the specification, the schemas, the code and the tests. You may use it, change it, build your own implementation of it and sell what you make. Keep the copyright notice and the [`NOTICE`](NOTICE) file with any copy you pass on. The licence gives no right to the KhannaOffice name.

Copyright 2026 Rohan Khanna, carrying on business as KhannaOffice. The full terms are in [`LICENSE`](LICENSE). For anything else, write to hello@khannaoffice.com.

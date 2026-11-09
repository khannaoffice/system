# Storage contracts

The System specifies what storage must do, not what it must be. Each contract has a reference
implementation in this repository and may be replaced by another that honours it.

## 1. Store (`packages/state/src/store.ts`)

A key-value store of JSON values: `get`, `set`, `delete`, `keys(prefix)`.

- Values are plain JSON. Keys are strings; `keys` returns them sorted.
- A `set` is atomic per key: a reader sees the old value or the new one.
- It is local: an implementation MUST NOT send data to another machine unless a person has switched on
  synchronisation (SPEC 12.2, 19.1).
- References: memory, IndexedDB (browser), a folder of readable JSON files (node).
- Opening may fail (private windows, blocked site data). Callers fall back to memory and tell the person
  their work is not kept (`openStore`).

## 2. The write-state log (`packages/state/src/world-store.ts`)

- **Append-only events**, one key each (`world:event:00000001`), written once and never rewritten.
- **A snapshot** (`world:snapshot`) of everything else the write layer holds, with the number of events it
  includes.
- The log is written before the snapshot. On opening, events beyond the snapshot mean a crash; any
  operation the log shows committed with no receipt is `unknown`, never done and never failed.
- A store belongs to one owner. Opening it as another is refused.
- Local revisions lie over the published base only while they still follow it; one that no longer does is
  returned as `stale`, never applied over published content.
- Free text never enters the log: events carry a digest of an operation's arguments and their names.

## 3. Published content (`packages/adapters/git/src/git.ts`)

Published content is JSON files under `content/` in a Git repository:

| Path | Holds |
|---|---|
| `content/objects/<id>.json` | the current revision of an object |
| `content/revisions/sha256-<hex>.json` | every revision, immutable |
| `content/collections/<id>.json` | published collections and threads |

- Files are sorted-key, two-space JSON with a trailing newline, so a diff shows only real changes.
- A register is built from these files alone (`readContent`).
- A change is one commit. Its message carries trailers: `KO-Operation`, `KO-Receipt`, `KO-Capability`,
  `KO-Principal`, `KO-Actor`, `KO-Approval`, `KO-Revision`. The history alone says who did what, on whose
  behalf, with whose approval.
- Committing is idempotent (an operation is found again by its trailer) and commits only the files it
  wrote. It never pushes, fetches or clones.
- Private state (private collections, annotations, positions, grants) is never written here.

## 4. What is not specified yet

Remote synchronisation, conflict resolution between devices, and multi-user editing. When they are added
they sit behind the same Store and content contracts as optional adapters.

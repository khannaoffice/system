# Amendment 0001: intent, cadence, within, refusal

**Status:** Proposed against SPEC 0.1.0. To be merged as sections 31 to 34 in 0.2.0.
**Why:** SPEC 0.1.0 promises "a grammar of interactions independent of input method" (1, item 2)
but section 6 lists operations, not the intent that precedes them. It also leaves motion to one
paragraph (20.5) and has no authoring rules. The locked text is left untouched; these are additions.

---

## 31. Intent and input modes

An **Intent** is a participant's evidence that they are heading for a target, before they have
chosen it. It is `{ target, certainty }` where `certainty` is a number from 0 to 1.

31.1 Every interface adapter MUST translate its input into Intents and named operations (section 6).
No operation or primitive may require a particular input device.

31.2 Evidence differs by mode. An adapter SHOULD derive certainty from what its mode offers: a
projected pointer path, stylus hover height, a touch-down, focus travel and key repeat, a partial
voice transcript, gaze dwell, or a scanning cursor. Certainty MUST NOT be presented as a probability
unless a calibrated method exists (compare 4.8).

31.3 The page decides what an Intent means. The reading is the same number for an underline that
darkens, a reflection that firms up or a preview that opens.

31.4 Where a mode cannot supply a preview (touch has no hover), the preview MUST be reachable by an
equivalent step (a first tap that reveals, a second that commits; a long press that peeks).

31.5 The input mode is detected per input event, not per device, and may change mid-session.

31.6 Time constants belong to a mode's adapter, not to the reading.

## 32. Cadence and rest

32.1 Space has a module (20.1). Time MUST have one. Durations, easings, tick intervals and any
tones or haptic pulses MUST derive from a single declared base unit, so that every primitive keeps
the same time.

32.2 **Rest** is the defined state in which nothing animates and nothing glows. Every surface MUST
define its rest state, and every motion MUST return to it.

32.3 Reduced motion (20.5) selects rest plus the instant change; it MUST NOT remove information.

## 33. Within

33.1 When a state changes inside a surface, only what changes moves, and the move is proportional to
the change. A reorder moves the rows that moved; an update changes the value that changed.

33.2 A change is described as a minimal set of moves between two states, computed from identities
(4.1), never from position alone.

33.3 Any input during a move plays the remainder at speed, so a move never stands between a participant
and the surface.

33.4 Where motion is unavailable or unwanted, the surface simply changes, and an equivalent
non-visual announcement of the change is available.

## 34. Authoring rules

34.1 **Refusal.** An authoring tool MUST make an invalid state impossible where it can, rather than
reporting it afterwards. A placement off the lattice is refused, not flagged.

34.2 **The label.** Every published object carries a label of fixed structure: a medium line, then
paragraphs. The same label serves the page, the machine-readable record and the printed catalogue.

34.3 Conformance results (24) are available inside authoring tools, so a maker sees "this is not on
the system" at the moment of the mistake.

34.4 Every requirement in this amendment is registered for conformance testing before it is
implemented (see tests/conformance/registry.json).

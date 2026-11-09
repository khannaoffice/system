# KhannaOffice System
## Foundational Specification
**Version:** 0.1.0 — Proposed  
**Date:** 4 November 2026  
**Status:** Architectural draft  
**Scope:** Information systems, interfaces, agents, authoring and interaction

---

## 01. Purpose

The KhannaOffice System defines a coherent grammar through which people and computational agents can encounter, navigate, interpret, organise, transform and act upon information.

It is intended to operate across websites, documents, software applications, archives, visual collections, sequential media and other structured environments.

The System shall provide:

1. A common ontology for information and its relationships.
2. A grammar of interactions independent of input method.
3. A spatial and temporal model for navigation and continuity.
4. A capability model through which humans and agents can perform meaningful operations.
5. Rules governing identity, evidence, permission and change.
6. A visual and interaction language for presenting these concepts.
7. Interoperable interfaces built on established and emerging web standards.
8. An executable reference implementation and conformance suite.

The System is intended to be useful without an AI model. Agentic functionality extends its capabilities through the same underlying operations.

### 1.1 Governing principles

**Identity precedes representation.** An object has a durable identity independent of where or how it appears.

**Meaning precedes presentation.** Objects, relationships and operations have explicit semantics. Layout expresses those semantics.

**Position is meaningful.** Participants, objects and media may occupy identifiable positions within a shared information environment.

**Actions are explicit.** Meaningful operations have defined inputs, preconditions, effects and outcomes.

**State is intelligible.** Changes in position, selection, information and authority must be comprehensible.

**Evidence remains attached.** Claims, transformations and consequential actions retain appropriate provenance.

**Human judgment remains sovereign.** Agents may investigate, propose and execute permitted operations. Human authorship, consequential approval and accountability are preserved.

**Continuity is a first-class property.** Interruption, re-entry and changes of device should preserve the relevant state.

**The medium matters.** A film, document, map and software instrument may share underlying concepts while retaining their own native interaction characteristics.

**The implementation must be verifiable.** Foundational rules require schemas, tests and observable behaviour.

### 1.2 Scope of the first implementation

The first implementation shall cover structured web content, collections, documents, images and agent operations within browser and remote environments.

Time-based media, geographical interfaces, native applications, collaborative authoring and physical environments shall be supported by the conceptual model, with implementation staged separately.

### 1.3 Non-goals

The first version shall not attempt to provide a foundation model, universal AI runtime, replacement web browser, universal semantic ontology or complete general-purpose content management system.

It shall not require a conversational interface to expose agent capabilities.

It shall not prescribe a single aesthetic treatment for every application built upon it.

---

## 02. Specification authority

### 2.1 Normative language

**MUST** identifies a requirement for conformance.  
**MUST NOT** identifies a prohibition.  
**SHOULD** identifies a strong recommendation permitting documented exceptions.  
**MAY** identifies an optional facility.

All new requirements in this draft are proposed until formally accepted and versioned.

### 2.2 Three levels of authority

**Established:** Decisions already governing KhannaOffice projects, particularly Unigrid and the existing editorial system. These shall be preserved.

**Proposed:** New System requirements introduced by this specification. They require implementation and verification.

**Experimental:** Dependencies on immature standards, research hypotheses or unvalidated interaction models. These shall be isolated from the stable core.

### 2.3 Compatibility

The System MUST preserve existing Unigrid geometry and published API contracts.

The existing `PageGrid → Unigrid → Cell` relationship remains authoritative within the KhannaOffice site implementation.

The System MUST NOT require a redesign of established typography, site navigation, content hierarchy or product identities.

A site MAY adopt only selected System capabilities without implementing the entire framework.

---

## 03. Architectural model

The System is divided into six layers.

### Layer A — Information

Defines the objects that exist, their identities, types, representations, relationships and provenance.

### Layer B — State

Defines position, selection, focus, ordering, activity, history, collections and participant-specific context.

### Layer C — Capability

Defines the meaningful operations available on information and state, together with their schemas and effects.

### Layer D — Authority

Defines identity, access, delegation, consent, approval, validation and auditing.

### Layer E — Interface

Provides visual, tactile, keyboard, assistive and agentic expressions of the underlying information and capabilities.

### Layer F — Interoperability

Makes the System available through HTML, structured data, HTTP APIs, browser tools, remote agent protocols and export formats.

### 3.1 Fundamental rule

The implementation of an operation shall reside below the interface adapters.

A user command, a keyboard shortcut, a browser-agent tool and a remote-agent tool invoking the same semantic operation MUST share the same business rules, validation and authority checks.

Interface-specific behaviours such as hover animations, pointer movement and transitions need not become agent tools.

### 3.2 Authoritative state

The canonical information store is authoritative for published objects.

Participant-specific state may be maintained locally, remotely or through an explicitly synchronised combination.

A presentation layer MUST NOT silently create a competing version of canonical information.

---

## 04. Ontology

The System requires a small, extensible collection of fundamental entities.

### 4.1 Object

An Object is any independently identifiable entity.

Examples include a photograph, work, publication, video, research argument, software instrument, physical place or collection.

Required properties:

- `id`: immutable, opaque identifier.
- `type`: declared object classification.
- `title`: human-readable name.
- `revisionId`: identifier of the current immutable revision.
- `visibility`: public, unlisted or private.
- `createdAt`: creation timestamp.
- `representations`: one or more available representations.
- `provenance`: authorship or source record.

Published objects additionally require a canonical URI.

Optional properties include summary, description, creators, publication dates, relations, tags, spatial metadata, temporal metadata, capabilities and external identifiers.

IDs MUST remain stable after title changes, route changes and reordering.

### 4.2 Representation

A Representation is a particular expression of an Object.

Examples:

- An HTML article.
- A photograph's original file.
- A thumbnail.
- A JSON-LD record.
- A PDF edition.
- A machine-readable transcript.
- A diagram showing an underlying construction.
- A native application window displaying the same information.

Representations MUST reference their parent object and, where necessary, the corresponding revision.

Each representation shall declare its media type, language where relevant, availability and integrity metadata where supported.

A transformed or derived representation MUST preserve attribution to its source.

### 4.3 Relation

A Relation is a typed, directed association between two objects.

The minimum relation vocabulary is:

| Relation | Meaning |
|---|---|
| `partOf` | Object belongs to a larger object |
| `contains` | Object contains another object |
| `follows` | Ordered succession |
| `precedes` | Ordered precedence |
| `references` | Explicit reference |
| `derivedFrom` | Provenance or derivation |
| `relatedTo` | General association |
| `depicts` | Representation of a subject |
| `locatedAt` | Spatial association |
| `supports` | Evidence supports a claim |
| `contradicts` | Evidence or argument conflicts |
| `revisionOf` | Version lineage |

Additional relation types MAY be registered with documented semantics.

Relations MUST identify their endpoints and type. Authored and generated relations MUST have distinguishable provenance.

An inferred relationship must never silently become an authored fact.

### 4.4 Collection

A Collection is an identifiable, ordered or unordered set of object references.

Collections MAY be:

- Authored and published.
- Generated from a query.
- Created privately by a reader.
- Assembled by an agent under delegated authority.
- Shared between authorised participants.

Membership MUST preserve object identity.

An ordered collection requires an explicit order key. Its order cannot depend on accidental database retrieval order.

### 4.5 Surface

A Surface is an environment in which objects or representations can be encountered and positioned.

Initial surface types:

| Surface | Primary position model |
|---|---|
| Document | Semantic anchors and reading position |
| Index | Item, ordering and filter state |
| Sequence | Ordered item and sequence offset |
| Time-based media | Timecode, chapter or frame |
| Image | Region and scale |
| Map | Coordinates, region and zoom |
| Application | View, selection and operational context |
| Physical environment | Location and orientation |

A Surface MAY contain other Surfaces.

The System MUST distinguish an object's identity from its position on a surface.

### 4.6 Participant

A Participant is an entity capable of receiving information or performing operations.

Supported kinds:

- Human.
- Agent.
- System process.
- Organisation or service acting within a defined role.

A Participant has an identity where required, a role, an active context and an authority boundary.

An agent acting for a person MUST be distinguishable from that person in recorded actions.

### 4.7 Revision

A Revision is an immutable historical state of an object.

The System MUST preserve revision identity when published content changes.

A mutable object pointer may reference its latest revision. Citations, annotations and reproducible exports MAY reference a specific historical revision.

### 4.8 Claim and Warrant

A Claim is a statement that may be supported, contested or qualified.

A Warrant is the structured record of evidence and reasoning offered to justify a claim or operation.

A Warrant contains:

- Subject or claim identifier.
- Supporting source references.
- Precise source locations where available.
- Method or derivation.
- Author or generating participant.
- Applicable revision.
- Known limitations.
- Status: supported, contested, incomplete or unverified.

Numerical confidence MUST NOT be fabricated when no calibrated method exists.

### 4.9 Event and Receipt

An Event records an occurrence within the System.

A Receipt records the verified outcome of an operation.

An Event may describe an attempted action, a state transition or a system observation. A Receipt shall distinguish successful execution from approval, proposal or failure.

The canonical event model shall be append-only where auditability is required.

---

## 05. KhannaOffice content ontology

The institutional publishing model shall preserve its existing distinctions.

**Product:** The thing itself—its definition, current status, use, distribution and technical record.

**Research:** The argument—its problem, context, method, provenance, evidence, findings, limitations and references.

**Release:** The institutional act—a dated and permanent record of publishing, changing or delivering something.

A Work may have Product and Research aspects. A Release references the relevant Work and revision.

These are semantic aspects of the information model. A Work can appear in multiple registers without being duplicated as separate identities.

### 5.1 Established site routes

The KhannaOffice site continues to use its existing shell and routes, including:

- `/`
- `/index`
- `/info`
- `/product/[work]`
- `/research/[work]`
- `/release/[work]`
- `/utilities/[name]` where applicable.

The System's abstract model MUST remain independent of those particular paths.

### 5.2 Editorial records

Product records shall support direct demonstration, documentation, versions, distribution, source, licence and relevant research.

Research records shall support stable citations, figures, methods, evidence, limitations, references, authorship and reproducibility.

Release records shall retain their historical identity after subsequent releases.

---

## 06. The interaction grammar

Meaningful operations shall be described using a shared vocabulary.

| Operation | Meaning |
|---|---|
| Discover | Find objects or capabilities |
| Enter | Move into a surface or object |
| Locate | Establish a participant's current position |
| Inspect | Reveal additional properties or representations |
| Traverse | Follow a relationship |
| Order | Arrange an existing set by an explicit rule |
| Filter | Restrict an existing set by declared conditions |
| Compare | Examine two or more objects or states together |
| Gather | Collect object references |
| Annotate | Attach an observation to a target |
| Transform | Produce a new representation or derivative |
| Revise | Change an authorised mutable object |
| Share | Grant access to a representation or collection |
| Delegate | Authorise a participant to perform operations |
| Execute | Perform an authorised operation |
| Revoke | Withdraw authority or access |
| Return | Restore an earlier position or context |
| Audit | Examine a consequential history |

Each operation requires a specification of inputs, preconditions, state changes, outputs, errors and authority requirements.

### 6.1 Operation invariants

Operations MUST be semantically stable across interfaces.

They MUST have deterministic validation.

Side effects MUST be declared.

Consequential operations MUST produce an identifiable outcome.

Cancellation MUST be supported when technically possible.

An operation whose result cannot be determined MUST report uncertainty rather than success.

### 6.2 Reversibility

Operations shall be classified as:

1. Read-only.
2. Ephemeral and reversible.
3. Persistent and reversible.
4. Persistent with limited reversibility.
5. Irreversible or externally consequential.

The interface and capability description MUST communicate the relevant class.

Undo is a defined inverse operation or compensating action. It MUST NOT be represented as guaranteed where reversal is impossible.

---

## 07. Register and Ledger

**Register** designates the authoritative, discoverable inventory of objects and their metadata.

**Ledger** designates a view of that inventory, commonly chronological and filterable.

**Index** designates a user-facing interface for browsing a Register or Ledger.

This distinction keeps information storage separate from its presentation.

### 7.1 Register requirements

The Register MUST provide:

- Stable object references.
- Complete declared membership within its published scope.
- Typed metadata.
- Deterministic filtering.
- Deterministic ordering.
- Pagination or bounded retrieval.
- A queryable representation.
- Explicit handling of unavailable records.

A selective homepage MAY display any editorial subset. Its omissions must not affect the Register's completeness.

### 7.2 Ordering

An Ordering consists of:

- Field or calculation.
- Direction.
- Applicable object types.
- Missing-value behaviour.
- Deterministic tie-break rule.
- User-visible description.

Initial orderings:

- Publication date.
- Title.
- Type.
- Authored sequence.
- Relationship or thread order.
- Geographic position where meaningful.
- Colour where measurable and meaningful.
- Size where comparable.
- Recent personal activity, stored privately.

Ordering changes MUST preserve the current selection where that object remains in the resulting set.

A tie shall resolve against a stable object identifier or other explicitly declared key.

### 7.3 Search

Search shall return object references, match evidence where possible and declared ordering.

The results interface MUST distinguish exact matches, lexical matches and semantically inferred matches when different methods are used.

Search relevance scores MUST NOT be presented as factual confidence.

---

## 08. Whereabouts

Whereabouts is the model of location, orientation and continuity within an information environment.

The established conception—pages as places along one surface—shall remain the central interaction metaphor for compatible interfaces.

### 8.1 Position model

A Position may contain:

- `surfaceId`
- `objectId`
- `revisionId`
- `anchor`
- `axis`
- `offset`
- `selection`
- `viewState`
- `capturedAt`

Not every surface requires every field.

Positions MUST use meaningful anchors where available. Pixel coordinates alone are insufficient for durable document positions.

### 8.2 Navigation

Navigation MUST establish the destination object or surface before animating the transition.

A navigational transition shall preserve the participant's understanding of where the destination sits relative to the origin.

Browser Back and Forward MUST remain functional.

Deep links MUST identify the relevant destination without depending on prior navigation history.

### 8.3 Return

The System shall distinguish:

- **Back:** Return to the previous navigation state.
- **Resume:** Re-enter a previously suspended activity.
- **Return to place:** Restore position within an earlier surface.
- **Revisit:** Reopen a historically encountered object.
- **Compare with previous:** Inspect changes since an earlier encounter.

The restoration algorithm shall first attempt the original semantic anchor, then a valid nearby anchor, then an explicitly reported fallback.

### 8.4 Shared whereabouts

Each participant has an independent position.

An agent MAY make its current position visible to the human.

An agent MUST NOT forcibly change the human's viewport without permission or a direct request.

Following an agent's position shall be an explicit interaction mode.

---

## 09. Threads and relationships

A Thread is an intentional traversal through related objects.

Threads may be authored, privately assembled or generated by an agent.

A Thread consists of a stable identity, title, ordered members, relationship rationale and provenance.

### 9.1 Rules

The thread's identity remains persistent while navigating its members.

The interface MUST preserve the user's original place where a thread is entered from another surface.

Leaving a thread MUST offer a predictable return path.

An agent-generated thread MUST remain distinguishable from an authored one.

Generated relationships must have inspectable grounds.

### 9.2 Existing site behaviour

Existing desktop hover-driven thread presentation should be preserved where appropriate.

Keyboard and touch users must have an equivalent path to the underlying information.

Thread membership and navigation must not depend on pointer hover.

---

## 10. Layers

A Layer is a selectively revealed representation or interpretive apparatus associated with an object or surface.

Supported layer purposes:

- Source material.
- Construction geometry.
- Annotation.
- Provenance.
- Evidence.
- Comparison.
- Revision differences.
- Agent attention or activity.

### 10.1 Behaviour

Layers MUST identify what they represent.

A Layer shall not silently alter the underlying canonical object.

Multiple layers MAY coexist when their meanings do not conflict.

The user MUST be able to restore the unlayered view.

Layers associated with evidence MUST retain a route to the relevant source.

### 10.2 Visual expression

The existing technique of revealing source drawings on look or press remains applicable.

A layer may use disclosure, overlay, split view or an alternative presentation appropriate to the medium.

Layer controls must remain usable through keyboard and assistive technology.

---

## 11. Resolution and scale

Resolution defines the degree of information exposed at a given moment.

The System shall support progressive disclosure across at least four conceptual levels:

1. **Recognition:** Identity and essential distinguishing information.
2. **Overview:** Summary, relationships and context.
3. **Examination:** Full representation and supporting detail.
4. **Verification:** Sources, construction, revisions or other inspectable evidence.

These levels are semantic. They do not require four separate screens.

### 11.1 Behaviour

Increasing resolution MUST preserve object identity.

A lower-resolution representation MUST NOT misrepresent the object.

Missing detail shall be reported as unavailable rather than invented.

The level of detail may vary by available space, user intention and task.

Agents MAY request particular representations or detail levels through explicit parameters.

---

## 12. Gather and personal collections

Gather allows a participant to assemble a personal Register of references.

### 12.1 Initial requirements

- Add and remove objects.
- Reorder references.
- Preserve the source object and revision reference.
- Add optional notes.
- Export a structured collection.
- Resume on the same device.
- Keep collections private by default.

### 12.2 Data ownership

Private collections and marks shall initially be local-first.

They MUST NOT be transmitted to a remote service without a relevant user action or configured synchronisation permission.

### 12.3 Agent participation

An agent may propose a collection.

With suitable authority it may add, remove or arrange entries.

The human must be able to examine the proposed changes and retain final control over public publication.

---

## 13. Annotation and authorship

Annotations shall support attachment to:

- Whole objects.
- Revisions.
- Document anchors.
- Text selections.
- Image regions.
- Media time ranges.
- Sequence members.
- Geographic locations.

Each annotation shall preserve author, target, body, creation time, visibility and applicable revision.

The initial implementation SHOULD align exported annotation structures with the W3C Web Annotation Data Model.

### 13.1 Authoring

Authoring changes shall be classified as drafts, proposals or committed revisions.

A proposed revision must remain distinguishable from published content.

Concurrent changes require conflict detection.

Publishing is a distinct operation from editing.

### 13.2 Attribution

The System shall record whether an authored change originated from a person, agent or automated process.

Model-generated content must not inherit human authorship merely because it was committed through a human account.

---

## 14. Time, history and change

Time appears in three distinct domains.

**Object time:** When information was created, published, observed or revised.

**Surface time:** Position within a temporal medium such as video or audio.

**Interaction time:** The sequence and duration of participant activities.

The System MUST avoid conflating these.

### 14.1 Historical inspection

Objects with revision histories shall support inspection of previous revisions.

A difference view should identify additions, deletions and changes at the most appropriate semantic level.

### 14.2 Changes since last encounter

Where the participant has opted into local history, the interface MAY indicate:

- Previously unseen objects.
- Revised objects.
- New relationships.
- Changes to an existing collection.

Private encounter history must remain private by default.

### 14.3 Temporal media

Time-based media shall expose stable chapter markers and timecode references.

A frame or segment MAY become an annotation target, a collection member or the subject of an evidence reference.

---

## 15. Capability system

A Capability is a declared operation available within a particular authority context.

It has:

- Stable identifier and version.
- Human-readable name.
- Concise semantic description.
- Input and output JSON Schemas.
- Preconditions.
- Effect classification.
- Required permission scopes.
- Confirmation requirement.
- Idempotency requirements.
- Cancellation behaviour.
- Result and error definitions.
- Audit requirements.

Capabilities are registered independently of their browser or remote protocol representation.

### 15.1 Initial capability catalogue

| Capability | Purpose | Default effect |
|---|---|---|
| `ko_search_objects` | Search a Register | Read |
| `ko_read_object` | Retrieve object and representation metadata | Read |
| `ko_list_relations` | Inspect typed relationships | Read |
| `ko_read_thread` | Retrieve thread membership | Read |
| `ko_get_warrant` | Retrieve evidence for a claim | Read |
| `ko_compare_revisions` | Retrieve historical differences | Read |
| `ko_get_position` | Retrieve accessible position state | Read |
| `ko_set_position` | Change a participant's navigation position | Ephemeral |
| `ko_create_collection` | Create private collection | Persistent reversible |
| `ko_add_to_collection` | Add existing object references | Persistent reversible |
| `ko_reorder_collection` | Change collection order | Persistent reversible |
| `ko_create_annotation` | Write an annotation | Persistent reversible |
| `ko_preview_change` | Stage a proposed change | Non-public |
| `ko_commit_change` | Commit authorised revision | Consequential |
| `ko_publish_collection` | Publish a collection | Consequential |
| `ko_get_receipt` | Inspect operation outcome | Read |

Not every application exposes every capability.

### 15.2 Registration

A capability is available only when the underlying application implements it and the participant has the necessary authority.

Discovery MAY describe unavailable capabilities, but MUST clearly distinguish them from executable ones.

### 15.3 Versioning

Breaking schema or semantic changes require a new capability version.

Existing tool names should retain stable semantics.

Adapters MUST reject unsupported versions explicitly.

---

## 16. Agentic interaction model

Agents are first-class participants.

An agent may observe information, discover capabilities, request representations, navigate, assemble collections, propose modifications and execute permitted operations.

### 16.1 Agent session

An agent session records:

- Participant identity.
- Represented principal, if any.
- Granted scopes.
- Current task.
- Current position.
- Accessible objects.
- Pending operations.
- Result history.
- Expiration and cancellation state.

A remote protocol connection shall not itself be treated as durable session identity.

### 16.2 Task lifecycle

Tasks transition through:

`created → discovering → proposing → awaiting_approval → executing → verifying → completed`

At appropriate points, a task may instead become `paused`, `blocked`, `failed` or `cancelled`.

All transitions must have defined preconditions.

The System shall distinguish task completion from successful completion of every individual operation.

### 16.3 Visible activity

The human interface shall be capable of showing:

- What the agent is examining.
- Which capability it is using.
- What action it proposes.
- What information has changed.
- Whether human approval is required.
- What the operation actually returned.

This information may appear in the relevant surface or an inspectable activity record.

A permanently visible chat panel is not required.

### 16.4 Shared attention

An agent may maintain an independent selection or position.

The interface MAY show an agent's active object, examined references or proposed collection.

Sharing attention shall be permission-based and reversible.

An agent's selection shall not steal keyboard focus or automatically scroll the human's view.

### 16.5 Handoff

Handoff transfers responsibility for the next step between human and agent.

A handoff record shall specify:

- Current task.
- Completed operations.
- Pending operation.
- Relevant objects and revisions.
- Required human input.
- Current authority.
- Resume mechanism.

The receiving participant must be able to inspect the pending work before resuming it.

### 16.6 Evidence-bearing output

When an agent makes a factual assertion about System content, its output SHOULD reference the relevant objects, revisions and anchors.

A claim without supporting evidence must be identifiable as inference or an unsupported assertion.

### 16.7 Agent neutrality

Core objects and capabilities shall not contain dependencies on a specific model vendor.

The System shall support model-free operation and non-agent access to the same public information.

---

## 17. Web and protocol interoperability

All protocol adapters shall be driven by the canonical model and capability registry.

### 17.1 HTML

Human-facing content MUST retain semantic HTML and ordinary navigation.

Core public information should be available without execution of an AI runtime.

Links, forms, headings and landmarks shall remain meaningful to browsers and assistive technologies.

### 17.2 Structured data

Published objects SHOULD have JSON-LD representations using Schema.org and other established vocabularies where appropriate.

Canonical identity, authorship, relationships, dates and representation links should be exposed.

Custom concepts shall use a versioned KhannaOffice vocabulary rather than overloading unrelated Schema.org terms.

### 17.3 HTTP API

The reference implementation shall expose a versioned API, initially:

- `GET /api/v1/objects`
- `GET /api/v1/objects/{id}`
- `GET /api/v1/objects/{id}/relations`
- `GET /api/v1/objects/{id}/revisions`
- `GET /api/v1/collections/{id}`
- `POST /api/v1/operations/{capability}`
- `GET /api/v1/operations/{operationId}`

Public reads may be unauthenticated.

Private resources and operations require authentication and authorisation.

Responses require machine-readable error codes.

List endpoints require bounded pagination and stable ordering.

Mutable resources should support revision preconditions to prevent unnoticed overwrites.

### 17.4 WebMCP

The browser adapter shall expose appropriate capabilities using the experimental `document.modelContext` API when available.

The adapter MUST:

- Feature-detect support.
- Register only implemented capabilities.
- Provide accurate descriptions and JSON Schemas.
- Use supported effect annotations.
- Handle cancellation.
- Unregister obsolete tools when appropriate.
- Invoke the canonical operation layer.
- Validate all inputs and permissions independently.
- Report structured results.

The browser adapter shall never be the sole means of accessing important public information.

Declarative agent-enabled forms MAY be added where supported, subject to browser compatibility and specification changes.

### 17.5 Remote MCP

The remote adapter shall support the applicable MCP specification, with protocol version handling and client compatibility tests.

It should expose:

- Tools for operations.
- Resources for structured objects and documents.
- Prompts for optional, reusable user-invoked workflows.

Public tools may use anonymous access where appropriate.

Private and write operations require suitable authentication and scoped authority.

Durable task continuity shall use explicit task identifiers or handles rather than assumed transport-session state.

### 17.6 Agent UI event transport

The System shall define its own small, stable event model.

An AG-UI adapter MAY translate those events into compatible streamed agent–interface events, including lifecycle, tool activity and shared-state changes.

The core shall not depend on AG-UI for persistence or validation.

### 17.7 Natural-language discovery

A natural-language search adapter MAY be provided through NLWeb or an equivalent interface.

Its answers shall resolve to canonical object identities and source references.

The deterministic Register API remains authoritative for the object set.

### 17.8 Agent-to-agent communication

A2A MAY be introduced for tasks requiring communication between independent agents or services.

It shall not be required for ordinary browsing, collection assembly or in-page collaboration.

### 17.9 Additional discovery

The System SHOULD provide ordinary sitemaps, canonical links and appropriate metadata.

`llms.txt` MAY supply a useful guide to machine-readable resources. Its presence does not replace structured data, APIs or normal site navigation.

---

## 18. Authority and permissions

Authority is evaluated at the operation boundary.

A tool's presence, description or claimed safety classification does not grant permission.

### 18.1 Permission model

An authorisation grant defines:

- Principal.
- Acting participant.
- Resource scope.
- Permitted operations.
- Constraints.
- Expiration.
- Revocation status.
- Approval requirements.

The System shall default to least privilege.

### 18.2 Risk policy

| Effect | Default treatment |
|---|---|
| Read public content | Allowed |
| Read private content | Authorisation required |
| Move agent's own position | Allowed within context |
| Change human's visible position | Direct instruction or opt-in |
| Change private collection | Scoped permission |
| Share private content externally | Explicit approval |
| Publish or modify public content | Explicit approval |
| Delete or irreversibly transform | Explicit confirmation and available recovery information |
| Grant additional authority | Explicit approval |

Applications may impose stricter requirements.

### 18.3 Prepare and commit

Consequential operations SHOULD use a two-stage model:

1. **Prepare:** Validate inputs and show the exact intended effects.
2. **Commit:** Revalidate authority and relevant revisions, then execute.

An approval shall be bound to the specific operation and its material inputs.

Changes to those inputs invalidate the approval.

### 18.4 Security

The implementation MUST defend against:

- Prompt injection in documents, annotations and tool results.
- Untrusted tool descriptions.
- Cross-origin privilege confusion.
- Unauthorised data export.
- Replay of consequential operations.
- Confused-deputy behaviour.
- Stale approvals.
- Accidental exposure of private browsing or collection state.
- Misleading descriptions of tool effects.

Every write shall undergo server-side or authoritative-domain validation even if previously validated in the interface.

### 18.5 Auditing

Consequential operations must record the actor, represented principal, requested capability, relevant object versions, authorisation decision, outcome and timestamp.

Sensitive inputs should be minimised or redacted in audit records.

---

## 19. State, persistence and synchronisation

State shall be classified into four categories.

**Canonical:** Published objects, revisions, relationships and authoritative metadata.

**Personal:** Marks, collections, reading history, private annotations and preferences.

**Session:** Current task, selection, position and temporary interaction context.

**Ephemeral presentation:** Hover states, animation progress and other disposable visual state.

### 19.1 Local-first

Personal state shall initially use browser-local persistence, with IndexedDB as the reference web implementation.

Private data must remain local until synchronisation or sharing is enabled by an explicit action.

### 19.2 Synchronisation

Optional synchronisation shall:

- Preserve stable identities.
- Support interruption and retry.
- Detect revision conflicts.
- Avoid silent destructive overwrites.
- Preserve collection ordering.
- Retain operation identifiers for idempotency.
- Communicate unavailable or conflicting states.

Collaborative and multi-device reconciliation algorithms shall be specified separately before implementation.

### 19.3 URL state

Publicly shareable position and query state MAY be encoded in URLs.

URLs MUST NOT inadvertently expose private notes, private collection contents, credentials or internal task state.

### 19.4 Session restoration

A suspended task shall resume from an explicit saved state.

The System MUST verify that required permissions, object revisions and capabilities remain valid when the task resumes.

---

## 20. Visual and spatial system

KhannaOffice System shall preserve the visual discipline already established by Unigrid and KhannaOffice UI.

The foundational layout engine remains `@khannaoffice/unigrid`.

### 20.1 Established Unigrid geometry

- Fixed module: 84 × 80 CSS pixels.
- Horizontal interval: 12 CSS pixels.
- Vertical interval: 10 CSS pixels.
- Integer coordinates and spans.
- One shared lattice.
- Capacity determined from the available material width.
- Authored composition based on coordinates and spans.
- Fluid composition based on spans and source order.

The module MUST NOT be continuously scaled to imitate responsiveness.

Where authored coordinates cannot be maintained, the existing collective release into fluid composition applies.

The implementation shall preserve its documented overflow and minimum-capacity behaviour.

### 20.2 Layout integration

KhannaOffice site layouts shall continue to use their existing `PageGrid → Unigrid → Cell` architecture.

System components should consume resolved geometry instead of implementing competing grids.

The grid governs spatial placement. It does not impose arbitrary rules on text baselines or invalidate typographic judgment.

### 20.3 Editorial hierarchy

The system shall preserve:

- Institutional framing.
- Restrained typography.
- Clear distinction between argument and evidence.
- Fixed, deliberate text measure.
- Authorial hierarchy.
- Inspectable geometry.
- Existing visual tokens and component decisions.

No new universal colour, radius or font system is established in this specification.

Individual applications may have distinct visual treatments while sharing the semantic and interaction model.

### 20.4 Van de Graaf and proportional frames

Van de Graaf constructions remain available as explicit compositional methods.

Their constraints shall be mathematically defined and tested at supported view sizes.

They are application-specific composition rules, not universal requirements imposed on every System surface.

### 20.5 Motion

Motion shall communicate spatial continuity, change of state or relationship.

Transitions must preserve a legible beginning and destination.

Users requesting reduced motion shall receive an equivalent experience without unnecessary animation.

### 20.6 Agent presentation

Agents may be represented through selection, position, activity marks, marginal notes or other restrained visual techniques.

The design shall not require avatars, simulated cursors, generic chatbot windows or decorative demonstrations of activity.

An agent's state should remain discoverable without continuously demanding attention.

### 20.7 Accessibility

The reference implementation shall target WCAG 2.2 AA.

All meaningful actions require keyboard access.

Focus must remain visible and predictable.

Hover-revealed functionality requires accessible alternatives.

Semantic content must remain available when animation or enhanced browser tools are disabled.

---

## 21. Arrival and boundary conditions

Arrival defines how a surface establishes its structure before content and media are fully available.

The System shall reserve known spatial envelopes before asynchronous assets load.

Content loading must not unnecessarily displace the reader's established position.

### 21.1 Required boundary states

Every reference component and capability shall define behaviour for:

- Empty.
- Loading.
- Partial.
- Failed.
- Offline.
- Unavailable.
- Unsupported.
- Permission denied.
- Permission revoked.
- Cancelled.
- Timed out.
- Stale revision.
- Conflict.
- Deleted object.
- First item.
- Last item.
- No search results.
- Unresolvable position.

### 21.2 Failure rules

A failure must not be represented as an empty successful result.

Partially completed operations shall report which effects occurred.

An unavailable agent protocol shall leave ordinary human interaction functional.

An unresolvable historical reference shall preserve its identifier and report its status rather than silently substituting unrelated content.

---

## 22. Data and machine contracts

The reference implementation shall publish JSON Schema Draft 2020-12 definitions for its externally serialised objects.

### 22.1 Core contracts

The minimum schema set:

- `object.schema.json`
- `representation.schema.json`
- `relation.schema.json`
- `collection.schema.json`
- `position.schema.json`
- `annotation.schema.json`
- `claim.schema.json`
- `warrant.schema.json`
- `capability.schema.json`
- `operation-request.schema.json`
- `operation-result.schema.json`
- `participant.schema.json`
- `grant.schema.json`
- `task.schema.json`
- `event.schema.json`
- `receipt.schema.json`

Every persisted structure requires an explicit schema version or a documented relationship to the System version.

### 22.2 Operation request

The canonical operation request shall carry:

- Unique request ID.
- Capability ID and version.
- Input arguments.
- Acting participant.
- Relevant resource references.
- Expected revisions where applicable.
- Optional idempotency key.
- Relevant authority context.

### 22.3 Operation result

An operation result shall have one of the following statuses:

- `ok`
- `needs_approval`
- `denied`
- `conflict`
- `cancelled`
- `failed`
- `unknown`

Successful results contain validated output data.

Consequential results also reference a Receipt.

Failures contain a stable error code and a recoverable explanation when possible.

An unknown result indicates that execution may have occurred but could not be verified.

### 22.4 Event envelope

A canonical event shall include:

- `eventId`
- `type`
- `occurredAt`
- `actorId`
- `taskId`, where applicable
- `operationId`, where applicable
- `resourceIds`, where applicable
- `causationId`, where applicable
- `payload`
- `schemaVersion`

Event consumers must tolerate unknown optional fields and reject unsupported required versions safely.

### 22.5 Integrity and signatures

Where integrity is required, immutable representations may be associated with content digests.

Cryptographic signing of receipts or published records is an optional future capability and requires a separately specified key-management and verification model.

Unsigned records shall never be described as independently cryptographically verified.

---

## 23. Implementation architecture

The proposed reference implementation shall be modular.

### 23.1 System core

Responsibilities:

- Object and relation schemas.
- Identity and revision rules.
- Operation registry.
- Validation.
- Authority evaluation.
- Position semantics.
- Event and receipt generation.
- Error classification.

The core shall have no required dependency on React, browser APIs or a particular AI provider.

### 23.2 State package

Responsibilities:

- Participant positions.
- Session restoration.
- Local collections.
- Annotations.
- Ordering and filtering state.
- Persistence.
- Optional synchronisation adapters.

### 23.3 Web adapter

Responsibilities:

- Semantic HTML integration.
- Structured data.
- Routing and deep links.
- Accessibility.
- Browser history.
- View Transitions.
- Browser capability registration.
- Unigrid-based presentation where selected.

### 23.4 Protocol adapters

Separate adapters shall handle:

- HTTP/JSON.
- WebMCP.
- Remote MCP.
- AG-UI, when needed.
- NLWeb, when needed.
- A2A, when independently justified.

Adapters shall translate external protocol structures into the same core operations.

### 23.5 Reference applications

The first applications should exercise different aspects of the System:

**Register:** A structured archive of works with search, typed relations, threads and history.

**Reader:** A research publication with evidence, annotations, comparison and durable positions.

**Gallery:** A photographic collection with sequence, image regions and personal gathering.

**Agent workspace:** A demonstration of parallel human and agent activity, preview, approval and handoff.

All four may be implemented within a single reference environment before being distributed as independent applications.

### 23.6 Proposed project structure

- `spec/` — normative documents and decisions.
- `schemas/` — JSON Schemas and examples.
- `packages/core/` — ontology and operations.
- `packages/state/` — positions, history and persistence.
- `packages/web/` — browser and semantic web integration.
- `packages/adapters/webmcp/`
- `packages/adapters/mcp/`
- `packages/adapters/ag-ui/`
- `packages/components/` — interface components built upon existing visual foundations.
- `apps/reference/` — reference environment.
- `fixtures/` — canonical example records.
- `tests/conformance/` — contract and behavioural tests.

This is a proposed organisation. Existing repositories and packages are not implicitly renamed or replaced.

---

## 24. Conformance

Conformance shall be established through automated tests, independent inspection and reference applications.

### 24.1 Identity tests

- An object retains its ID across title changes.
- One object can appear in multiple collections without duplicated identity.
- Historical revision links continue to resolve after publication of newer revisions.
- A deleted object produces an explicit missing or withdrawn state.

### 24.2 Register tests

- Ordering is deterministic across repeated requests.
- Filtering retains stable membership semantics.
- Ties resolve consistently.
- A human view and corresponding machine query produce equivalent object sets under the same filters and authority.
- Published Register membership is complete within its declared scope.

### 24.3 Whereabouts tests

- Direct links restore a meaningful position.
- Browser navigation returns to the previous context.
- Surface resizing preserves meaningful anchors.
- Failed anchor restoration reports an explicit fallback.
- Agent navigation cannot unexpectedly seize human focus.

### 24.4 Agent tests

- Public read capabilities work without unnecessary approval.
- Unauthorised private reads fail without leaking private data.
- Consequential actions require appropriate approval.
- Changed material inputs invalidate approval.
- Cancelled operations report their actual status.
- Duplicate write requests using the same idempotency key do not duplicate effects.
- Tool descriptions cannot override operation-level authority.
- A resumed task revalidates its required grants.

### 24.5 Protocol parity tests

The same public read operation shall produce semantically equivalent responses through:

1. The reference HTTP API.
2. Remote MCP.
3. WebMCP where supported.
4. The human interface's underlying data operation.

Protocol-specific wrappers may differ.

### 24.6 Visual and accessibility tests

- Unigrid geometry conforms to its established module and interval rules.
- Authored and fluid layouts preserve their documented behaviour.
- Loading media does not introduce avoidable layout displacement.
- All meaningful controls work through keyboard interaction.
- Reduced-motion settings are respected.
- Thread navigation remains accessible without hover.
- Print and export outputs preserve defined semantics.

### 24.7 Security tests

- Public records cannot be used to inject operational instructions into an agent's authority context.
- Cross-origin tool invocation does not bypass origin or scope checks.
- Stale operation approvals fail safely.
- External sharing requires the correct permission.
- Private records do not enter public indexes or structured-data exports.
- Every committed consequential operation has a traceable result.

---

## 25. Measurement and performance

Performance shall be measured at the level of user experience, information retrieval and operation reliability.

### 25.1 Human experience

Measure:

- First meaningful content availability.
- Largest Contentful Paint.
- Interaction to Next Paint.
- Cumulative Layout Shift.
- Navigation continuity.
- Focus stability.
- Successful task completion.
- Keyboard-only operation.

The initial web implementation shall target the established good Core Web Vitals thresholds and WCAG 2.2 AA.

### 25.2 Machine interaction

Measure:

- Capability discovery success.
- Input validation failures.
- Operation latency.
- Operation completion rate.
- Incorrect success claims.
- Permission violations.
- Evidence reference accuracy.
- State restoration success.
- Human intervention frequency.
- Protocol parity.

### 25.3 Evaluation corpus

The conformance corpus should initially include at least:

- 1,000 objects.
- 5,000 typed relations.
- Multiple object revisions.
- 300 annotations.
- 50 media objects.
- Public and private records.
- Conflicting and broken references.
- Slow and unavailable resources.
- Concurrent human and agent operations.

These are proposed fixture sizes rather than claims about existing deployments.

### 25.4 Quality standard

A component is incomplete if it only demonstrates an appearance while its underlying interaction, data integrity, accessibility, export or failure handling remains unresolved.

Visual review remains necessary for composition and optical judgment.

---

## 26. Development programme

### Stage 0 — Formalise the foundation

Deliver:

- Accepted terminology and invariants.
- Entity and relation schemas.
- Capability definition format.
- Authority and event models.
- Canonical example objects.
- Architectural decision records.
- Initial conformance harness.

**Exit condition:** Independent implementations can interpret the same example records and operation definitions.

### Stage 1 — The readable and queryable environment

Implement:

- Register.
- Object identities and representations.
- Relationships.
- JSON-LD.
- Search, ordering and filtering.
- HTTP API.
- Read-only MCP and experimental WebMCP adapters.

**Exit condition:** A human and a compatible agent can discover the same objects and relationships through their respective interfaces.

### Stage 2 — Position and personal state

Implement:

- Generalised Whereabouts.
- Durable semantic anchors.
- Threads.
- Layers.
- Gather.
- Local-first persistence.
- Return and restoration.

**Exit condition:** Positions, selections and collections survive normal navigation, resizing, interruption and re-entry.

### Stage 3 — Shared human–agent interaction

Implement:

- Agent participant model.
- Task state machine.
- Visible activity.
- Shared attention.
- Operation approvals.
- Handoff.
- Receipts.
- Event-stream adapter.

**Exit condition:** An agent can investigate, gather, propose and complete an authorised task while the human maintains control and can inspect the outcome.

### Stage 4 — Authoring and change

Implement:

- Structured annotations.
- Versioned revisions.
- Proposed edits.
- Publication controls.
- Conflict handling.
- Evidence and provenance inspection.
- Optional private synchronisation.

**Exit condition:** Authoring changes remain attributable, reversible where promised and consistently represented across interfaces.

### Stage 5 — Additional media and environments

Extend to:

- Time-based media.
- Geographic interfaces.
- Native applications.
- Multi-participant workspaces.
- Selected physical-environment representations.

**Exit condition:** Each new medium can express the foundational primitives without introducing incompatible identity, permission or state semantics.

---

## 27. Publication and governance

The System shall publish its specification alongside its reference implementation.

Each release should contain:

1. Versioned normative specification.
2. Schemas and example records.
3. Reference implementation.
4. Conformance tests.
5. Compatibility notes.
6. Known limitations.
7. Decision and change history.

### 27.1 Extensibility

Extensions shall have a declared namespace, version and capability boundaries.

Extensions MUST NOT redefine existing foundational semantics without a major specification revision.

### 27.2 Historical integrity

Released specifications shall remain accessible.

Subsequent revisions must identify semantic changes and migration implications.

The System's research arguments, software implementation and publication records should remain separately identifiable within the existing KhannaOffice institutional model.

---

## 28. Questions requiring experimental validation

The following are deliberately unresolved:

**Agent presence:** What is the least intrusive visual representation of an agent's position, activity and intent?

**Attention:** When should the interface disclose an agent's work automatically, and when should the user request it?

**Shared state:** Which interactions benefit from live synchronisation, and which should remain private and asynchronous?

**Semantic position:** What constitutes the most durable anchor in a complex fluid document?

**Relationships:** How should authored, inferred and reader-created associations coexist without confusing their authority?

**Resolution:** How should the amount of revealed information adapt to the participant's intention and available space?

**Trust:** Which actions need formal evidence, and which can use ordinary interface feedback?

**Synchronisation:** What reconciliation model best preserves user-authored order, annotation and history across devices?

**Generalisation:** Which primitives survive translation into film, native applications and physical space without losing their usefulness?

These questions require experimental implementations, not arbitrary decisions made solely for architectural completeness.

---

## 29. First complete reference scenario

A researcher visits a structured archive containing photographs, publications and software projects.

The Register exposes the available objects through both its human interface and machine-readable channels.

The researcher asks an agent to identify connections between a collection of photographic studies and a system of spatial composition.

The agent searches the Register, retrieves objects, follows typed relations and examines supporting source material.

Its activity appears in the relevant interface without displacing the human's position.

The agent proposes a Thread containing several objects. Each link identifies whether the relationship was authored, directly evidenced or inferred.

The researcher follows the Thread, opens construction Layers and compares two representations.

The researcher then requests a private collection. The agent assembles the references using the authorised Gather capability.

The researcher changes the order, adds an annotation and leaves the site.

On return, the private collection, notes and relevant whereabouts remain available.

The researcher later requests publication.

The System prepares the proposed public collection, identifies its contents and audience, and requests confirmation.

Following approval, the collection is published as a versioned object, and the completed operation receives a Receipt.

A remote agent can subsequently discover the published collection through the same canonical information model.

The scenario tests identity, relation, position, resolution, evidence, local state, agent interaction, authority, publication and interoperability as one coherent system.

---

## 30. Definition of completion

KhannaOffice System 1.0 shall be considered complete when:

- Its foundational ontology is formally specified and implemented.
- Its operations have stable, independently testable contracts.
- Its reference environment is fully usable by humans without AI.
- Its relevant capabilities are available to compatible agents.
- Information identity persists across representation and interface changes.
- Navigation and personal context support reliable re-entry.
- Authorship, evidence and revisions are inspectable.
- Consequential actions preserve explicit authority and verified outcomes.
- The visual expression respects existing KhannaOffice and Unigrid foundations.
- Core behaviour is validated by a published conformance suite.
- The system demonstrates the same principles across at least three substantially different information environments.

The governing criterion is coherence: the same concepts must retain their meaning as the participant, medium, interface and task change.

---

**End of Foundational Specification 0.1.0 — Proposed**

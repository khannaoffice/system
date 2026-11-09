# Section status

Every section of [SPEC.md](SPEC.md) carries one authority level (SPEC 2.2) and the phase in which
it is first built. `npm test` fails if a section
is missing from this table or carries an unknown level.

- **Established**: already governs KhannaOffice projects; preserve it.
- **Proposed**: new here; needs implementation and a passing test before it counts.
- **Experimental**: depends on an immature standard or an open question; isolated from the stable core.

| § | Title | Authority | Phase | Note |
|---|---|---|---|---|
| 01 | Purpose | Proposed | 0 | |
| 02 | Specification authority | Proposed | 0 | |
| 03 | Architectural model | Proposed | 1 | Operations below adapters (3.1) is the first thing the core proves. |
| 04 | Ontology | Proposed | 1 | Schemas are derived from the real register, not invented ahead of it. |
| 05 | KhannaOffice content ontology | Established | 5 | Product, Research and Release already exist on khannaoffice.com. |
| 06 | The interaction grammar | Proposed | 1 | Intent signals are amendment 0001 section 31, built in the core (intent.ts); not yet wired on a site. |
| 07 | Register and Ledger | Proposed | 1 | The Ledger itself is Established on rohankhanna.com. |
| 08 | Whereabouts | Established | 2 | Pages-as-places is Established; the position model (8.1) is Proposed. |
| 09 | Threads and relationships | Established | 2 | Authored threads exist; typed and generated threads are Proposed. |
| 10 | Layers | Established | 2 | Look-to-see, press-to-keep exists; typed layer purposes are Proposed. |
| 11 | Resolution and scale | Proposed | 2 | |
| 12 | Gather and personal collections | Proposed | 2 | |
| 13 | Annotation and authorship | Proposed | 5 | |
| 14 | Time, history and change | Proposed | 5 | |
| 15 | Capability system | Proposed | 3 | |
| 16 | Agentic interaction model | Experimental | 4 | Agent presence and shared attention are open (section 28). |
| 17 | Web and protocol interoperability | Experimental | 3 | HTML and HTTP are stable; WebMCP, AG-UI, NLWeb and A2A are not. |
| 18 | Authority and permissions | Proposed | 4 | |
| 19 | State, persistence and synchronisation | Proposed | 2 | Synchronisation (19.2) is deferred past phase 5. |
| 20 | Visual and spatial system | Established | 2 | Unigrid geometry is fixed; agent presentation (20.6) is Experimental. |
| 21 | Arrival and boundary conditions | Proposed | 1 | |
| 22 | Data and machine contracts | Proposed | 1 | |
| 23 | Implementation architecture | Proposed | 1 | |
| 24 | Conformance | Proposed | 0 | Registry: tests/conformance/registry.json |
| 25 | Measurement and performance | Proposed | 2 | |
| 26 | Development programme | Proposed | 0 | |
| 27 | Publication and governance | Proposed | 6 | |
| 28 | Questions requiring experimental validation | Experimental | 6 | |
| 29 | First complete reference scenario | Proposed | 6 | The end-to-end acceptance test. |
| 30 | Definition of completion | Proposed | 6 | |

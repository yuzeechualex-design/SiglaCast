<!--
  SiglaCast — System documentation aligned with DosU / ITP 121 formatting guidance
  Source template: Template-Guide_ITP.pdf (margins/fonts: apply manually in Word)
  Source proposal excerpt: SiglaCast_Project_Proposal (proponents & objectives)

  Word setup reminder (template):
  - Paper: Letter 8.5 x 11 in; Margins Left 1.5 in; Right 1 in; Top/Bottom 1 in
  - Font: Arial 11 pt, black; Body double-spaced; Justify paragraphs
  - Chapter headings: UPPERCASE, bold, centered; Romanettes on preliminary pages; Arabic on body

  STYLE NOTE FOR AUTHORS: Paste into Word, then enforce third person,
  spelling out numbers below ten (e.g., "seven features"), and replace
  contractions if any slipped in during revision.
-->

# TITLE PAGE CONTENT (DOSU FORMAT)

**Davao Oriental State University**  
Guang-guang, Dahican, City of Mati, Davao Oriental

**SIGLACAST: VOTING AND COMMUNITY APPLICATION FOR DAVAO ORIENTAL STATE UNIVERSITY EVENTS**

Presented to the  
Bachelor of Science in Information Technology  
Davao Oriental State University  

In Partial Fulfillment  
of the Requirements for the Course  
**ITP 121 – Integrative Programming and Technologies 1**

---

**Proponents**

Alex B. Carloman Jr.  
Jera Mae Maigon  
Queenie Mae Recitas  
Mary Colyama  

*Bachelor of Science in Information Technology – Third Year*

**MAY 2026**

---

# TABLE OF CONTENTS

| Section | Title | Page |
|--------|-------|-----|
| | TITLE PAGE | i |
| | TABLE OF CONTENTS | ii |
| **CHAPTER 1** | **INTRODUCTION** | |
| 1.1 | Rationale | 1 |
| 1.2 | Purpose and Description | |
| 1.3 | General Objectives | |
| 1.4 | Specific Objectives | |
| 1.5 | Scope and Limitation | |
| 1.6 | Significance of the Study | |
| **CHAPTER 2** | **METHODOLOGY** | |
| 2.1 | Requirement Specification | |
| 2.1.1 | Functional Requirements | |
| 2.1.2 | Non-Functional Requirements | |
| 2.2 | System Analysis | |
| 2.2.1 | Business Process | |
| 2.2.2 | Use Case Overview | |
| | REFERENCES | |
| **APPENDIX A** | **SYSTEM SCREENSHOTS** | *(filled by proponents)* |
| **APPENDIX B** | **PHOTO DOCUMENTATION** | *(filled by proponents)* |

*(Page column: fill page numbers after final pagination in Word.)*

---

<p style="page-break-before: always;"></p>

# CHAPTER 1  
## INTRODUCTION

### 1.1 Rationale

University events—including student elections, competitions, and campus activities—often depend on dispersed communication channels and manual tallying workflows. Participation may remain low when announcements and ballots are difficult to locate, while engagement suffers when informal groups and official channels overlap without a unified space. Administrators and organizers require tools to publish structured events with rules, timelines, and auditable votes, whereas students benefit from continuity between formal voting and everyday discussion related to campus life.

Emerging literature on institutional web systems and participatory platforms consistently highlights usability, assurance of identity eligibility, and timeliness as drivers of sustained adoption among students (*see References—technology adoption / e‑governance summaries to be finalized by advisers*). The gap addressed by SiglaCast is the absence of a single application that merges **regulated voting workflows** with a **moderated campus community**, **instant messaging**, and **official announcements**, all governed under identifiable university accounts stored in one database.

Derived research questions informing the inquiry are stated below.

- Research Question One: What design for a consolidated web campus hub best supports transparent participation across voting, messaging, and community posts?
- Research Question Two: Which technical safeguards and implementation patterns provide traceable voting while limiting exposure of ballots to unintended parties?
- Research Question Three: Which integration strategies (hosted database, authenticated API, selective media storage) minimize operational friction for organizers without compromising security posture?

Problem statement: fragmented tools for engagement and voting leave students underserved; this study documents the conception, construction, and intended operation of SiglaCast as one integrated corrective.

Expectation hypothesis: when eligible users authenticate through centralized accounts and persist activity through a moderated backend, observable participation rises relative to unstructured chat-only approaches; verification requires deployment analytics controlled by sponsoring faculty (**to be calibrated with instructor expectations**).

### 1.2 Purpose and Description

The purpose is to engineer and demonstrate **SiglaCast**, a bilingual-mode (dark/light capable) Progressive Web-ready single-page frontend backed by Node.js REST services and Supabase Postgres, supporting **students** and **administrators**. Students vote in configured events according to enforced policies (strategy, quotas), interact on a community timeline with reactions and threaded replies, consume announcements with notification badges, send direct and group chats with attachments, and use supplemental anonymous **Userphone** bridges for exploratory peer chat. Administrators manage authoritative content (events, candidates, announcements) and supervise visibility.

### 1.3 General Objective

To design and develop SiglaCast as a web-based voting and community application oriented to official DORSU-aligned university events while preserving auditable transactional records behind authenticated interfaces.

### 1.4 Specific Objectives

- To enforce eligibility-gated authenticated access with JSON Web Tokens and refresh rotations plus password hashing.
- To expose voting strategies (single-choice and weighted quotas) surfaced through dashboards and tally logic.
- To implement community posting, moderation-friendly comment threads, emoji reactions on posts, and selective media uploads routed to object storage buckets.
- To deliver announcements and derived in-app/browser notifications keyed to unread sets.
- To provide conversational features: friendships, searchable directory, direct messaging, moderated group memberships, and supplementary anonymous bridging (Userphone) with schema-aware safeguards.
- To satisfy integrative-programming artefacts: polymorphic tally strategies and user role hierarchy, interchangeable message brokers (see Chapter Two), scripted XML exposition with transform endpoint, scripting utilities referenced in README, and ancillary monitoring helper scripts documented in repository materials.

*(Objectives synthesized from SiglaCast_Project_Proposal and extended to match deployed modules.)*

### 1.5 Scope and Limitation

**Scope (as implemented for ITP)**

- Roles: authenticated **students** vs **admins**.
- Voting lifecycle: admins create/update events plus candidates & strategy; eligible students vote where policy permits; aggregated tallies surfaced.
- Community: authored posts with optional imagery, expandable comment sections, emoji reactions on posts, threaded reply quotes in chat.
- Announcements surfaced with visual cueing tied to unseen items.
- Notifications table drives bell indicators and optional Browser Notification API prompting on desktops that grant permission (documented UX pattern).
- Messaging: friend requests pathway, direct pairwise threads with quoted replies / unsends (software-level flags), multipart attachments, searchable user discovery constrained by selectable profile columns.
- Group conversations: admins create memberships, elevate roles, optionally manage photos; messages mirror features of direct chat with mention parsing.
- Userphone anonymity path for solo random pairing plus optional group bridging when database artefacts exist—or in-memory failover when migration tables absent (**single-instance limitation** elaborated technically in deployment notes).

**Limitations**

- Primary delivery path is responsive **web**, not duplicate native binaries; mobile experience assumes modern browser—not all proposal-era Flutter/React Native deliverables concurrently shipped.
- Eligibility predicates remain application-level assumptions; linkage to Registrar authentication services is external to this codebase.
- National or unrelated external elections intentionally excluded—scope remains campus-aligned scenarios.
- Internet connectivity obligatory; degraded offline states not modeled.
- Service-role Supabase posture bypasses row-level-security for API simplicity; compromising API keys compromises whole dataset—credential hygiene critical.
- Userphone bridging outside migration-backed modes does not synchronize across clustered hosts.

### 1.6 Significance of the Study

Administrators acquire a repeatable template for structuring digital ballots with explicit strategy metadata. Student bodies obtain improved discoverability linking formal voting and conversational activity. Subsequent capstone cohorts reuse documented integration patterns bridging React, Express, and managed Postgres/storage. Institutional reviewers may trace reproducible provisioning steps described in DEPLOY/README for governance review.

*(Optional expansion: quantify survey metrics if instructor mandates empirical validation.)*

### 1.7 Concise Literature and Theoretical Anchoring *(recommended brief block)*

Adoption-centric lenses (Technology Acceptance notions of perceived usefulness/ease alongside trust in vote integrity—**cite authoritative sources per faculty guidance**) frame why unified authenticated hubs outperform isolated channels. Comparative studies on classroom response and electronic voting cite auditability gaps when integrity controls trail convenience; SiglaCast positions server-side transactional inserts with immutable surrogate keys logged per ballot.

---

<p style="page-break-before: always;"></p>

# CHAPTER 2  
## METHODOLOGY

### 2.1 Requirement Specification

#### **2.1.1 Functional Requirements**

| Area | Requirement | Implementation Reference |
|------|-------------|-------------------------|
| F-01 Authentication | Provide registration validating password entropy; login emits access + refresh tokens; rotation supported | Express `/auth` routes & bcrypt hashing |
| F-02 Role Authorization | Separate student vs admin surface areas & guard administrative POST/PATCH verbs | Middleware + JWT claims |
| F-03 Voting | Create events specifying strategy, quotas, statuses; tally votes distinctly for single vs weighted | Events/candidates/votes normalized tables |
| F-04 Community Timeline | Compose posts (+ optional imagery), emoji reactions aggregate per post, hierarchical comments (+ optional attachments) | `posts`, `post_reactions`, expanded comment schema migrations |
| F-05 Announcements | Publish ordered announcements surfaced with unread deltas | Dedicated table + aggregator notifications |
| F-06 Notifications | Store structured rows; unify badge summaries for nav pings | Consolidated unread counting logic (`App.jsx` & API) |
| F-07 Friends & Messaging | Maintain friendship graph; pairwise DM API; multipart upload for attachments | `friends`, `messages` evolution + storage helper |
| F-08 Group Chat | Provision conversation metadata tables; authorize membership; mirrored mention + reply parity | Conversations/group endpoints |
| F-09 User Experience | Persist dark/light palette via `localStorage` keyed theme attribute toggling CSS variables | `App.jsx`, global stylesheet overrides |
| F-10 XML Integrative Artefact | Produce canonical events XML listing; ingest parser route; optionally render HTML transform | Routes declared in README integrative bullets |
| F-11 Event Broker Artefact | Emit domain events (`vote.cast`, `post.created`, `announcement.created`, `message.sent`) | Pluggable RabbitMQ / Kafka / in-memory broker |
| F-12 Userphone Anonymity | Pair waiting users; ephemeral anonymous UI; bridging across groups guarded by sentinel guest identity migrations | Specialized tables (`anon_*`) & logic branches |

Functional traceability originates from stakeholder statements in the Proposal document and repository acceptance testing walkthrough scripts.

#### **2.1.2 Non-Functional Requirements**

| Class | Requirement | Notes |
|-------|-------------|-------|
| Security | Confidentiality of credentials via hashing; bearer token transport; segregation of frontend environment keys vs service role secrecy | Operational discipline essential |
| Performance | Periodic conversation refresh (~six seconds polling default) balancing freshness versus rate load | Tuneable intervals |
| Scalability | Stateless API suitable for horizontal scale; bottleneck moves to Postgres/Storage unless broker offload introduced | Mention Render/Vercel pattern |
| Usability | WCAG-aligned color palettes in dark/light; responsive breakpoints for narrow devices | Dedicated CSS breakpoints |
| Reliability | Idempotent-ish insert semantics for votes where constraints enforce uniqueness | Indexed uniqueness patterns |
| Maintainability | Modular React pages mirrored to REST noun routes; migrations versioned sequentially | Folder layout `frontend/src/pages` |
| Availability | Depends on upstream hosting SLA (Render + Supabase)—document honest dependency chain | Risk transparency |

### 2.2 System Analysis

#### **2.2.1 Business Process (Narrative)**

1. Administrators provision users (initial seeded accounts documented) or students self-register contingent on policy gates.
2. Administrators publish authoritative events attaching candidate rosters plus strategic constraints.
3. Students authenticate, traverse dashboard metrics, inspect open events, and cast permissible votes respecting strategy.
4. Community moderators implicitly curate implicitly through authored posts; admins remain super-level event authorities.
5. Announcement authors post bulletins escalating read-state tracking for recipients.
6. Students initiate friendships, accept/reject inbound requests (badged UI), escalate to DM or federate into group workspaces.
7. Optional Userphone bridging attempts pair anonymous peer threads or cross-group relays after queue windows elapse (**ten-second policy** default).
8. Periodic polling merges server truth into client caches; uploads route through multipart boundary encoding to REST then Supabase buckets.

**(Optional figure placeholder)** Swimlane diagram distinguishing Admin vs Student vs System automated tasks recommended for final Word layout.

High-level layered architecture:

```text
[ Browser React SPA ] ⇄ HTTPS JSON / multipart ⇄ [ Node Express REST ]
                                               ⇆ Supabase Postgres
                                               ⇆ Supabase Object Storage (media)
                                               ⇜ Optional RabbitMQ / Kafka /
                                               ⇒ In-memory synchronous broker shim
```

#### **2.2.2 Use Case Overview**

**Primary Actors**: Student User, Administrative User (system operator), Anonymous Userphone Participant (temporary masked identity façade).

Representative prioritized use cases (top-level—not exhaustive BPMN decomposition):

| ID | Actor | Goal |
|----|-------|------|
| UC-01 | Student | Authenticate securely |
| UC-02 | Student | Filter eligible events then vote |
| UC-03 | Student | Compose community post (+ optional imagery) react & comment chain |
| UC-04 | Student | Consume announcements acknowledging read progression |
| UC-05 | Student | Negotiate friendships & converse with attachments quoting |
| UC-06 | Student | Coordinate group memberships & escalate roles if permitted |
| UC-07 | Student | Optionally enter anonymous bridging queue respecting timeout UX |
| UC-08 | Admin | Maintain events & candidate catalog |
| UC-09 | Admin | Announce institution-wide textual bulletins |
| UC-10 | Both | Toggle visual theme ergonomically |
| UC-11 | System | Relay domain-integration broker fan-out (+ console logging scaffolding) |

Each route-level handler documents validation, branching, and transactional Supabase inserts; detailed sequence diagrams advisable for defended capstone escalation.

Cross-cutting safeguards: sanitized mention parsing in chat composers, guarded unsend semantics (tombstones), aggregator notification collapsing (DM vs announcement vs threaded reply).

### 2.3 Development Procedure (Operational Chronology Summary)

Environment bootstrap → schema migration authoring → scaffold Express server with modular route registration → scaffold Vite SPA with router segments → iterative feature merges (votes → timeline → announcements → messaging evolution) → integrative artefacts (broker, XML) → scripted packaging & deployment authoring → validation via demo credentials → iterative UI polish (navigation badges, thematic toggles).

### 2.4 Addressing Potential Biases and Limitations *(methodological reflexivity)*

Developer-selected defaults (polling cadence vs push-based eventual adoption of WebSockets) embed latency bias—users may perceive sluggish cross-client sync under heavy concurrency. Sampling bias emerges if testers skew technically proficient versus general student strata. Recommend structured pilot questionnaires if empirical claims become mandatory beyond artifact submission.

Testing scope should explicitly enumerate enumerated positive + negative pathways (illegal double vote insertion attempts, malformed uploads, revoked token navigation). Record outcomes in appendix tables.

---

# REFERENCES *(expand / format APA 7 under faculty directives)*

1. DosU Registrar & ITP Coordinators. *(Year).* Local course documentation & integrative marking rubrics—retain syllabus citation once issued.
2. Meta Open Source Community. *(2025).* React Documentation & Vite integration guides — `https://react.dev` ; `https://vitejs.dev`
3. Supabase, Inc. *(2025).* PostgreSQL platform & Row Level Security policy references — `https://supabase.com/docs`
4. OWASP Foundation. *(2025).* JWT / token handling cheat sheets — `https://cheatsheetseries.owasp.org`
5. PostgREST / Supabase error-handling discourse on schema cache synchronization—cite recent technical bulletin when elaborating migration discipline.
6. Field-specific journal articles regarding **Technology Acceptance**, **Electronic Voting Assurance**, **Higher Education LMS Engagement** *(insert authoritative peer-reviewed citations here per instructor approval).*  
7. Project repository internal documents: `README.md`, `DEPLOY.md`, `supabase/migrations/*.sql`.

---

# APPENDIX A — SYSTEM SCREENSHOTS *(to be pasted)*

*(Figure A-1 Landing / Auth Screen)*  

*(Figure A-2 Voting Event Detail Screen)*  

*(Figure A-3 Community Timeline & Comment Expansion)*  

*(Figure A-4 Messaging — Direct & Group Threads)*  

*(Figure A-5 Dark Mode Comparative)*  

Each figure requires caption numbering (Arial caption sizing per template exceptions).

---

# APPENDIX B — PHOTO DOCUMENTATION *(deployment / teamwork evidence)*  

Insert team photographic documentation validating integrative milestones (whiteboard sketches, stakeholder meetings, staged deployment confirmations). Provide reflective captions aligning each image to enumerated objectives above.

---

# APPENDIX C — TECHNICAL SUMMARY (SUPPLEMENTARY, NOT FORMAL TITLE PAGE ENUMERATION)

| Layer | Technology |
|-------|------------|
| Client | React 18 + React Router + Vite builder |
| Styling | Global CSS tokens + breakpoint responsive strategy |
| API | Express (Node ES modules) authenticated route surface |
| Persistence | Managed PostgreSQL schema via SQL migrations executed in Supabase project |
| Media | Bucket storage integration—avatars / event visuals / postings / chat blobs |
| Auth | bcrypt password derivation + JWT issuance & refresh hashing column |
| Integrative Scripts | Administrative setup shell/PowerShell; queue monitor script enumerated in README |
| Broker Interfaces | RabbitMQ queues OR Kafka topics OR ephemeral synchronous dispatcher |

### Data Entities (Abbreviated Logical View)

Primary persisted entities (non-exhaustive field listing): Users, Events, Candidates, Votes (unique per user/event under strategies), Posts, Comments, Announcements, Notifications, Friendships & Messages lineage (including evolution into conversation-group modeling), Reaction bridges, Auxiliary anonymous session tables bridging optional cross-group relays.

*(Appendix paragraphs support technical defense; prune if committee forbids appendix beyond mandated A/B.)*

---

## Document Control

| Version | Date | Author Note |
|---------|------|-------------|
| 0.9 | MAY 2026 | Draft assembled from codebase + Proposal DOCX excerpts + DosU formatting guide textual rules |

Revision checklist before submission: purge markdown-only artifacts (`---` horizontal rules) incompatible with departmental template; convert headings to Word built-in Heading styles levels 1–3; regenerate Table of Contents field; reconcile pagination hiding rules on chapter openers; proof numerals spelling under ten consistently.

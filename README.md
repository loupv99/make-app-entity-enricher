# Entity Enricher — Make.com Custom App

> Fork de [TOT-Concept/make-app-entity-enricher](https://github.com/TOT-Concept/make-app-entity-enricher) —
> mi contribución: tests automatizados para los 6 blueprints de ejemplo (`test/examples.test.mjs`,
> `scripts/lib/example-lint.mjs`, corridos con `npm test`). No había ninguno. Cubren lint estructural
> (referencias de módulo resuelven, campos requeridos presentes, sin referencias `{{N.…}}` hacia
> adelante) más 7 contratos que fijan como test automático los gotchas que `examples/README.md` ya
> documentaba a mano — por ejemplo que el Text Aggregator del blueprint 06 agrupe por el cursor
> correcto, o que Generate Sample fuerce `sampleCount=1` cuando hay un adjunto. Todo lo demás —
> la app, los 15 módulos, la documentación, la licencia — es obra original de TOT Concept.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A [Make.com](https://www.make.com) Custom App for [**Entity Enricher**](https://entityenricher.ai) — an AI-powered platform that **enriches any entity against a JSON schema using multiple LLMs in parallel**, with automatic fusion, **multilingual output in 40 languages**, and pre-flight classification.

> Drop a single Make module into any scenario, map an entity from a previous step, and receive a structured, schema-validated, multi-model-fused JSON object — with multilingual output produced in a single LLM pass. No SSE handling, no retry plumbing, no prompt engineering.

![Demo: enriching an entity inside a Make scenario](https://entityenricher.ai/docs/demo-single-enrichment-make-connector.gif)

The app covers the whole loop, not just the enrichment call:

- **Author the schema from Make** — generate sample objects of an entity type (optionally from a PDF or a photo), turn them into a saved schema.
- **Feed it documents and images** — upload a file once, reference it by id in any enrichment or sample generation.
- **Enrich** — one call, N models, N languages, fused server-side.
- **Land it in your own database** — as real, migrated relational tables, synced by a client you run.

### Enrichments become a real database — yours

The enrichment is the easy half. What you normally end up building yourself — the tables to hold the
results, the DDL, the migration when the shape changes, and a loader that keeps it consistent — is
what a **database sync** does for you:

- **A designed schema, not a JSON dump.** Register a database on a schema and Entity Enricher derives
  the relational model from it: a table per entity type, `PRIMARY KEY`s, real `FOREIGN KEY`s, child
  tables for the parts an entity owns, junction tables for entities it merely references (one row
  many parents point at, not a copy per parent), typed columns, and indexes on what a list screen
  actually filters and sorts on. An LLM classification pass proposes each column's SQL contract at
  link time; you curate it in the Model tab.
- **Migrations you don't write.** Edit the schema and publish: the change is diffed against what each
  database has actually shipped and travels down the same feed as the data — additive DDL applied
  silently, riskier transforms (a re-key, a type change, a renamed column) held for your confirmation.
  No hand-written `ALTER`, no drift between the schema and the database.
- **Synced by an open-source client you run.** [`ee-database`](https://github.com/TOT-Concept/ee-database)
  is an MIT-licensed Go binary that lives next to *your* PostgreSQL, MySQL or SQLite. It connects
  **outward** over WSS — no inbound firewall hole — and **your connection string never leaves the
  machine**: Entity Enricher never holds a credential to your database. It bootstraps from a `.sql`
  snapshot, applies each leased batch transactionally, acknowledges it, and halts loudly on a failing
  delta rather than skipping it. Releases are **Sigstore-signed** and the installer verifies that
  signature against the publishing workflow's identity before the binary is ever executable.

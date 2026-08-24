// Automated tests for the 6 example blueprints (examples/*.json).
//
// These blueprints call real external LLM/document APIs — there's no local
// engine to "run" them against, so what's tested is the shape:
//   1. Generic structural lint (scripts/lib/example-lint.mjs) — module refs
//      resolve, required fields are present, {{N.…}} refs point at modules
//      that already ran.
//   2. Config-drift contracts for the specific gotchas examples/README.md
//      documents by hand — so a future edit to an example can't silently
//      reintroduce a mistake the README explicitly warns against.
// Run with `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadRequiredFields, lintExampleBlueprint } from "../scripts/lib/example-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXAMPLES_DIR = join(ROOT, "examples");

const requiredFields = loadRequiredFields(ROOT);

function loadExample(file) {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

// --- 1. Generic structural lint, every example -----------------------------

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();

test("sanity: all 6 example blueprints are present", () => {
  assert.equal(exampleFiles.length, 6, `expected 6 example blueprints, found ${exampleFiles.length}: ${exampleFiles.join(", ")}`);
});

for (const file of exampleFiles) {
  test(`lint: ${file} — module refs resolve, required fields present, no forward refs`, () => {
    const bp = loadExample(file);
    const findings = lintExampleBlueprint(bp, requiredFields);
    const errors = findings.filter((f) => f.level === "error");
    assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  });
}

// --- 1b. Prove the linter actually catches breakage, on synthetic blueprints ---

test("lint: catches a missing required field, a forward ref, a duplicate id, and an unknown module", () => {
  const broken = {
    flow: [
      { id: 1, module: "entity-enricher:enrichEntity", mapper: { entityData: "{}" } }, // missing required schemaId
      { id: 1, module: "entity-enricher:deleteAttachment", mapper: { attachmentId: "{{9.id}}" } }, // dup id 1 + forward ref to 9
      { id: 2, module: "entity-enricher:notARealModule", mapper: {} },
    ],
  };
  const findings = lintExampleBlueprint(broken, requiredFields);
  const codes = findings.map((f) => f.code);
  assert.ok(codes.includes("missing-required-field"), JSON.stringify(findings, null, 2));
  assert.ok(codes.includes("duplicate-id"), JSON.stringify(findings, null, 2));
  assert.ok(codes.includes("unresolved-ref"), JSON.stringify(findings, null, 2));
  assert.ok(codes.includes("unknown-module"), JSON.stringify(findings, null, 2));
});

test("lint: an unrecognized (non-app) module is a warning, not an error", () => {
  const bp = { flow: [{ id: 1, module: "google-sheets:addRow", mapper: {} }] };
  const findings = lintExampleBlueprint(bp, requiredFields);
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
  assert.equal(findings[0]?.code, "unrecognized-external-module");
});

// --- 2. Contracts for gotchas examples/README.md documents by hand ---------

test("02: Iterator's array is a literal array, not a JSON string (README: \"a JSON string will not iterate\")", () => {
  const bp = loadExample("02-iterator-batch.json");
  const feeder = bp.flow.find((m) => m.module === "builtin:BasicFeeder");
  assert.ok(Array.isArray(feeder.mapper.array), "module 1's mapper.array must be a real array");
});

test("03 + 04: every uploaded attachment is deleted by id in the same flow (README: \"billed as storage, delete when you're done\")", () => {
  for (const file of ["03-document-to-enrichment.json", "04-image-to-sample-to-schema.json"]) {
    const bp = loadExample(file);
    const upload = bp.flow.find((m) => m.module === "entity-enricher:uploadAttachment");
    const del = bp.flow.find((m) => m.module === "entity-enricher:deleteAttachment");
    assert.ok(upload, `${file}: expected an uploadAttachment module`);
    assert.ok(del, `${file}: expected a deleteAttachment module`);
    assert.equal(del.mapper.attachmentId, `{{${upload.id}.id}}`, `${file}: deleteAttachment must clean up the same upload it created`);
  }
});

test("04: Generate Sample models the server-forced sampleCount=1 when Attachment IDs is set", () => {
  const bp = loadExample("04-image-to-sample-to-schema.json");
  const sample = bp.flow.find((m) => m.module === "entity-enricher:generateSample");
  assert.ok(sample.mapper.attachmentIds.length > 0, "expected this example to actually be attachment-sourced");
  assert.equal(sample.mapper.sampleCount, 1, "sampleCount must be 1 — the module forces this whenever Attachment IDs is set");
});

test("05: Generate Schema has generateSemanticIds=true (README: \"it is on in this blueprint\")", () => {
  const bp = loadExample("05-samples-to-schema.json");
  const schema = bp.flow.find((m) => m.module === "entity-enricher:generateSchema");
  assert.equal(schema.mapper.generateSemanticIds, true);
});

test("06: the Text aggregator groups by module 1's Next cursor (README: \"Group by is set to module 1's Next cursor\")", () => {
  const bp = loadExample("06-database-sync-drain.json");
  const fetchDeltas = bp.flow.find((m) => m.module === "entity-enricher:fetchDatabaseDeltas");
  const aggregator = bp.flow.find((m) => m.module === "builtin:TextAggregator");
  assert.equal(aggregator.parameters.feeder, fetchDeltas.id, "aggregator must feed off the Fetch Database Deltas module");
  assert.equal(aggregator.mapper.group, `{{${fetchDeltas.id}.next_cursor}}`, "Group by must be Next cursor — that's what puts the cursor on the aggregated bundle");
});

test("06: Acknowledge maps upToId from the aggregated bundle's key, not straight from the fetch (README: \"Acknowledge only after the commit\")", () => {
  const bp = loadExample("06-database-sync-drain.json");
  const aggregator = bp.flow.find((m) => m.module === "builtin:TextAggregator");
  const ack = bp.flow.find((m) => m.module === "entity-enricher:ackDatabaseDeltas");
  assert.equal(ack.mapper.upToId, `{{${aggregator.id}.key}}`, "acking straight from Fetch Database Deltas would release the lease before the transaction (module 3) commits");
});

test("06: claim is enabled — Acknowledge only makes sense against a leased window", () => {
  const bp = loadExample("06-database-sync-drain.json");
  const fetchDeltas = bp.flow.find((m) => m.module === "entity-enricher:fetchDatabaseDeltas");
  assert.equal(fetchDeltas.mapper.claim, true);
});

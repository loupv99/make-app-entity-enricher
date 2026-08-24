// Structural lint for imported Make blueprints against this app's own module
// definitions — no Make account, no network, catches the mistakes a hand
// edit of examples/*.json can silently introduce:
//   - a module key that doesn't match any modules/<name>/ folder
//   - a required input field (per that module's expect.imljson) missing from
//     the mapper entirely
//   - a {{N.field}} reference to a module id that doesn't exist, or that
//     hasn't run yet at that point in the flow
//   - a duplicate module id
//
// This is deliberately NOT a Make execution engine (see make-testkit for
// that, on scenario-shaped blueprints) — these examples call real external
// LLM/document APIs, so there is no meaningful local "run" to simulate.
// What's checkable without a network call is the shape: does this blueprint
// still ask this app's modules for what they require.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Modules this app does NOT own (core Make / generic builtins used in the
// examples to fetch a file, iterate, or aggregate). We don't have their
// expect.imljson, so we only confirm the key is a module we recognize —
// not that its mapper is well-formed.
const KNOWN_EXTERNAL_MODULES = new Set([
  "http:ActionGetFile",
  "builtin:BasicFeeder",
  "builtin:TextAggregator",
  "util:SetVariable2",
]);

/** name -> Set of required input field names, read from modules/<name>/expect.imljson. */
export function loadRequiredFields(appRoot) {
  const modulesDir = join(appRoot, "modules");
  const required = new Map();
  for (const name of readdirSync(modulesDir)) {
    const file = join(modulesDir, name, "expect.imljson");
    if (!existsSync(file)) continue;
    const fields = JSON.parse(readFileSync(file, "utf8"));
    required.set(name, new Set(fields.filter((f) => f.required).map((f) => f.name)));
  }
  return required;
}

/** Depth-first walk over every module, descending into routes/onerror (none in these examples, but future-proof). */
function* walkModules(flow) {
  for (const mod of flow ?? []) {
    yield mod;
    for (const route of mod.routes ?? []) yield* walkModules(route.flow ?? []);
    if (Array.isArray(mod.onerror)) yield* walkModules(mod.onerror);
  }
}

// Pull every {{ N.… }} expression's leading module-id reference out of a mapper.
function* imlRefs(value) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{\s*(\d+)\b/g)) yield Number(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) yield* imlRefs(v);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) yield* imlRefs(v);
  }
}

/**
 * Lint one blueprint.
 * @param bp Parsed blueprint JSON ({ flow: [...] }).
 * @param requiredFields Map from loadRequiredFields().
 * @returns Array<{ level: "error"|"warning", code, moduleId?, message }>
 */
export function lintExampleBlueprint(bp, requiredFields) {
  const findings = [];
  const flow = bp.flow ?? [];
  const mods = [...walkModules(flow)];

  const seenIds = new Set();
  const idsUpToHere = new Set(); // ids of modules already visited, in flow order
  for (const mod of mods) {
    if (seenIds.has(mod.id))
      findings.push({ level: "error", code: "duplicate-id", moduleId: mod.id, message: `module id ${mod.id} appears more than once` });
    seenIds.add(mod.id);

    for (const ref of new Set(imlRefs(mod.mapper))) {
      if (!idsUpToHere.has(ref))
        findings.push({ level: "error", code: "unresolved-ref", moduleId: mod.id, message: `mapper references {{${ref}.…}} but module ${ref} hasn't run yet (or doesn't exist)` });
    }

    if (mod.module?.startsWith("entity-enricher:")) {
      const name = mod.module.slice("entity-enricher:".length);
      const req = requiredFields.get(name);
      if (!req) {
        findings.push({ level: "error", code: "unknown-module", moduleId: mod.id, message: `"${mod.module}" doesn't match any modules/<name>/ folder in this app` });
      } else {
        for (const field of req) {
          if (!(field in (mod.mapper ?? {})))
            findings.push({ level: "error", code: "missing-required-field", moduleId: mod.id, message: `${mod.module} requires "${field}" — missing from mapper` });
        }
      }
    } else if (!KNOWN_EXTERNAL_MODULES.has(mod.module)) {
      findings.push({ level: "warning", code: "unrecognized-external-module", moduleId: mod.id, message: `"${mod.module}" is not one of this app's modules and not on the recognized-external allowlist — verify by hand` });
    }

    idsUpToHere.add(mod.id);
  }

  return findings;
}

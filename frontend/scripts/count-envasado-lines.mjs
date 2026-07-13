#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createWorkItemRegistry } from "../src/lib/domain/work-item/work-item-registry.ts";
import { workItemAssembler } from "../src/lib/domain/work-item/work-item-assembler.ts";
import { projectDomainWorkItems } from "../src/lib/domain/work-item/work-item-projector.ts";
import { parsePlannerTab } from "../src/lib/parsers/planner/planner-parser.ts";

const rows = JSON.parse(
  execSync("python3 /workspace/frontend/scripts/load-acondicionamiento.py", {
    maxBuffer: 50 * 1024 * 1024,
  }).toString()
);

const registry = createWorkItemRegistry();
parsePlannerTab({
  fileId: "local",
  tab: "ACONDICIONAMIENTO",
  rows,
  registry,
  assembler: workItemAssembler,
});

const items = projectDomainWorkItems(registry.list());
const masivo = items.filter((i) => i.sector === "ENVASADO_MASIVO");
const premium = items.filter((i) => i.sector === "ENVASADO_PREMIUM");
const missing = items.filter(
  (i) => (i.sector === "ENVASADO_MASIVO" || i.sector === "ENVASADO_PREMIUM") && !i.line
);
const unexpected = missing.filter((i) => i.lineExpectedInSheet === true);
const documented = missing.filter((i) => i.lineExpectedInSheet !== true);

const lineDist = {};
for (const i of [...masivo, ...premium]) {
  const key = i.line ?? "(sin línea)";
  lineDist[key] = (lineDist[key] ?? 0) + 1;
}

console.log(JSON.stringify({
  masivo: masivo.length,
  premium: premium.length,
  withLine: masivo.length + premium.length - missing.length,
  missingTotal: missing.length,
  unexpected: unexpected.length,
  documentedLegacy: documented.length,
  lineDist,
  unexpectedSamples: unexpected.slice(0, 5).map((i) => ({
    sector: i.sector,
    sourceRange: i.sourceRange,
    product: i.product,
  })),
}, null, 2));

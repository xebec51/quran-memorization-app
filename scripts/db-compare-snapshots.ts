import { readFileSync } from "node:fs";

const before = JSON.parse(
  readFileSync(
    new URL("../.migration-safety/snapshot-before.json", import.meta.url),
    "utf8"
  )
);
const after = JSON.parse(
  readFileSync(
    new URL("../.migration-safety/snapshot-after.json", import.meta.url),
    "utf8"
  )
);

let ok = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) ok = false;
}

check(
  "table counts identical",
  JSON.stringify(before.tableCounts) === JSON.stringify(after.tableCounts)
);
check(
  "unrelated-table checksums identical",
  JSON.stringify(before.unrelatedChecksums) ===
    JSON.stringify(after.unrelatedChecksums)
);
check(
  "MemorizationQuestion unrelated-columns checksum identical",
  before.memorizationQuestionUnrelatedChecksum ===
    after.memorizationQuestionUnrelatedChecksum
);

const beforeAssessments = before.assessmentByQuestionId as Record<
  string,
  string
>;
const afterAssessments = after.assessmentByQuestionId as Record<string, string>;
check(
  "same set of assessed question ids",
  JSON.stringify(Object.keys(beforeAssessments).sort()) ===
    JSON.stringify(Object.keys(afterAssessments).sort())
);
let assessmentValueMismatch = 0;
for (const [questionId, value] of Object.entries(beforeAssessments)) {
  if (afterAssessments[questionId] !== value) assessmentValueMismatch += 1;
}
check(
  `every assessment value unchanged (${Object.keys(beforeAssessments).length} rows)`,
  assessmentValueMismatch === 0
);

const beforeReveal = before.revealColumnsByQuestionId as Record<
  string,
  {
    state: string;
    answerRevealedAt: string | null;
    revealBoundaryVerseId: number;
    revealTotalAyahCount: number;
    revealedAyahCount: number;
  }
>;
const afterReveal = after.revealColumnsByQuestionId as Record<
  string,
  {
    state: string;
    answerRevealedAt: string | null;
    revealBoundaryVerseId: number;
    revealTotalAyahCount: number;
    revealedAyahCount: number;
  }
>;

check(
  "same set of question ids",
  JSON.stringify(Object.keys(beforeReveal).sort()) ===
    JSON.stringify(Object.keys(afterReveal).sort())
);

let stateChanged = 0;
let assessedRevealedCountChanged = 0;
let totalGrewOrEqualCount = 0;
let totalShrankCount = 0;
let boundaryChangedCount = 0;
let constraintViolations = 0;

for (const [id, b] of Object.entries(beforeReveal)) {
  const a = afterReveal[id];
  if (!a) continue;
  if (a.state !== b.state) stateChanged += 1;
  if (b.state === "ASSESSED" && a.revealedAyahCount !== b.revealedAyahCount) {
    assessedRevealedCountChanged += 1;
  }
  if (a.revealTotalAyahCount >= b.revealTotalAyahCount)
    totalGrewOrEqualCount += 1;
  else totalShrankCount += 1;
  if (a.revealBoundaryVerseId !== b.revealBoundaryVerseId)
    boundaryChangedCount += 1;
  if (a.revealedAyahCount > a.revealTotalAyahCount) constraintViolations += 1;
}

check("no question's state was changed by the migration", stateChanged === 0);
check("revealTotalAyahCount never shrank for any row", totalShrankCount === 0);
check(
  "revealedAyahCount <= revealTotalAyahCount holds for every row after migration",
  constraintViolations === 0
);

const totalRows = Object.keys(beforeReveal).length;
console.log(
  `\nrows where revealBoundaryVerseId changed: ${boundaryChangedCount} / ${totalRows}`
);
console.log(
  `rows where revealTotalAyahCount grew or stayed equal: ${totalGrewOrEqualCount} / ${totalRows}`
);
console.log(
  `ASSESSED rows whose revealedAyahCount changed (expected: only legacy over-claimed rows, if any): ${assessedRevealedCountChanged}`
);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);

import "../lib/env";
import { validateQuestionAnchors } from "../lib/memorization/validation";

/**
 * --strict (CI passes this, see .github/workflows/ci.yml) turns a found
 * violation into a failing exit code. Manual/local runs against the real
 * dev database default to informational-only, since that database has
 * ~56 known historical rows predating the anchor-start rule (real users
 * already answered them - see the comment in lib/memorization/validation.ts)
 * that are intentionally left as-is rather than rewritten.
 *
 * In CI this script runs against a fresh ephemeral database AFTER
 * test:e2e (not before, and not right after quran:load-fixture) so it is
 * actually checking real MemorizationQuestion rows the e2e suite just
 * generated - checking it earlier, against a database with zero question
 * rows, could never find a real violation and was a no-op gate that only
 * looked like coverage.
 */
const strict = process.argv.includes("--strict");

async function main() {
  const result = await validateQuestionAnchors();
  process.stdout.write(
    `Checked ${result.totalQuestions} questions: ${result.violations.length} anchor-invariant violation(s).\n`
  );
  for (const violation of result.violations) {
    process.stdout.write(
      `  - ${violation.questionId} (page ${violation.primaryPageNumber}, ${violation.anchorVerseKey}): ${violation.reason}\n`
    );
  }
  if (result.violations.length > 0 && !strict) {
    process.stdout.write(
      "This is informational, not a release blocker: historical rows predating the anchor-start rule are left as-is rather than rewritten (real users already answered them). New questions cannot violate this - see lib/memorization/reveal/service.ts and question/generator.ts.\n"
    );
  }
  if (result.violations.length > 0 && strict) {
    process.stderr.write(
      "--strict: failing because this database should contain only freshly-generated questions, which must never violate the anchor-start invariant.\n"
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Anchor validation failed"}\n`
  );
  process.exit(1);
});

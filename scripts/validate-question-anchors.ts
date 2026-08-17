import "../lib/env";
import { validateQuestionAnchors } from "../lib/memorization/validation";

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
  if (result.violations.length > 0) {
    process.stdout.write(
      "This is informational, not a release blocker: historical rows predating the anchor-start rule are left as-is rather than rewritten (real users already answered them). New questions cannot violate this - see lib/memorization/reveal/service.ts and question/generator.ts.\n"
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Anchor validation failed"}\n`);
  process.exit(1);
});

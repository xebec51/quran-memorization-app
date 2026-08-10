import "../lib/env";
import { validateQuranData } from "../lib/quran/validation/validate";

async function main() {
  const result = await validateQuranData();
  if (!result.ok) {
    process.stderr.write(`Quran validation failed:\n${result.errors.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`Quran validation passed: ${JSON.stringify(result.counts)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Quran validation failed"}\n`);
  process.exit(1);
});

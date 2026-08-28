import "../lib/env";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  importStqhnQuestions,
  parseStqhnRecords
} from "../lib/quran/stqhn/import";

const DEFAULT_SOURCE = path.join(
  process.cwd(),
  "STQHN 2025",
  "stqhn2025_all_5_videos_hifzh_master_372_with_youtube_links.json"
);

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_SOURCE;
  const raw = readFileSync(filePath, "utf8");
  const records = parseStqhnRecords(JSON.parse(raw));
  const result = await importStqhnQuestions(records);
  process.stdout.write(
    `STQHN 2025 import completed: ${JSON.stringify(result)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "STQHN import failed"}\n`
  );
  process.exit(1);
});

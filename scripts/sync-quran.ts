import "../lib/env";
import { QuranFoundationProvider } from "../lib/quran/provider/quran-foundation";
import { syncQuranData } from "../lib/quran/sync/sync";

async function main() {
  if (!process.env.QF_CLIENT_ID || !process.env.QF_CLIENT_SECRET) {
    throw new Error("QF_CLIENT_ID and QF_CLIENT_SECRET are required for Quran synchronization.");
  }
  const result = await syncQuranData(new QuranFoundationProvider());
  process.stdout.write(`Quran sync completed: ${JSON.stringify(result.counts)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Quran sync failed"}\n`);
  process.exit(1);
});

import "../lib/env";
// Duplicates lib/auth/rate-limit.ts's cleanupExpiredRateLimits query
// rather than importing it: that module is `import "server-only"`
// guarded, which throws outside a Next.js bundle context (see
// CLAUDE.md's note on scripts/@ imports). Intended to be run manually or
// wired into an external scheduler (Vercel Cron, GitHub Actions) - the
// app itself also does small-probability opportunistic cleanup inline on
// every rate-limit check, so this script is a supplement, not the only
// mechanism.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const WINDOW_MS = 10 * 60 * 1000;
const RETENTION_MS = WINDOW_MS * 6;

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const result = await prisma.authRateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } }
  });
  process.stdout.write(
    `Deleted ${result.count} expired AuthRateLimit row(s) older than ${cutoff.toISOString()}.\n`
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Rate-limit cleanup failed"}\n`
  );
  process.exit(1);
});

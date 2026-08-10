import "../lib/env";
import { prisma } from "../lib/db/prisma";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const email = "demo@example.com";
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Demo",
      passwordHash: await hashPassword("demo-password-123")
    }
  });
  process.stdout.write("Seed completed. Demo user: demo@example.com\n");
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Seed failed"}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

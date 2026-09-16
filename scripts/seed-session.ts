// Dev tool: creates a signed-in test user + session and prints the session
// cookie value, so the upload/job flow can be exercised over HTTP via curl.
//   node --env-file=.env --import tsx scripts/seed-session.ts

import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";

const EMAIL = "smoke@test.local";

async function main() {
  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: EMAIL, passwordHash: "dev-only", fullName: "Smoke test" },
    });
  }
  const sessionId = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });
  console.log(sessionId);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
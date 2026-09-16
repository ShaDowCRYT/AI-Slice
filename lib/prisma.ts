// Prisma client singleton.
// In development, Next.js hot-reloads modules, which would create multiple
// PrismaClient instances. This pattern stores the client on globalThis to
// ensure a single instance survives across hot reloads.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

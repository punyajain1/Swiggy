import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

let client: PrismaClient | undefined;

/** Shared Prisma client, connected to Neon's pooled endpoint through the Neon driver adapter. */
export function prisma(): PrismaClient {
  if (!client) {
    const adapter = new PrismaNeon({ connectionString: env().DATABASE_URL });
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

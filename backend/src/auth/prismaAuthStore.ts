import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { emptyAuthRow, type AuthRow, type AuthStore } from "./authStore.js";

const ROW_ID = 1;

// Prisma needs Prisma.DbNull (not plain null) to clear a Json column.
const json = (value: unknown) => (value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue));

/** Stores the single SwiggyAuth row in Postgres. */
export class PrismaAuthStore implements AuthStore {
  async get(): Promise<AuthRow> {
    const row = await prisma().swiggyAuth.findUnique({ where: { id: ROW_ID } });
    if (!row) return emptyAuthRow();
    return {
      clientInformation: row.clientInformation,
      discoveryState: row.discoveryState,
      accessTokenEnc: row.accessTokenEnc,
      refreshTokenEnc: row.refreshTokenEnc,
      tokenMeta: row.tokenMeta,
      expiresAt: row.expiresAt,
      codeVerifier: row.codeVerifier,
      state: row.state,
      stateCreatedAt: row.stateCreatedAt,
      disconnectedReason: row.disconnectedReason,
    };
  }

  async update(patch: Partial<AuthRow>): Promise<void> {
    const { clientInformation, discoveryState, tokenMeta, ...scalars } = patch;
    const data = {
      ...scalars,
      ...(clientInformation !== undefined ? { clientInformation: json(clientInformation) } : {}),
      ...(discoveryState !== undefined ? { discoveryState: json(discoveryState) } : {}),
      ...(tokenMeta !== undefined ? { tokenMeta: json(tokenMeta) } : {}),
    };
    await prisma().swiggyAuth.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...data },
      update: data,
    });
  }
}

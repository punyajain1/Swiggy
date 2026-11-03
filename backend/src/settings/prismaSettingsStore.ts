import { prisma } from "../db/prisma.js";
import { defaultSettings, type SettingsStore, type SettingsUpdate, type UserSettings } from "./settings.js";

const ROW_ID = 1;

function toSettings(row: UserSettings): UserSettings {
  return {
    addressId: row.addressId,
    addressLine: row.addressLine,
    defaultServings: row.defaultServings,
    skillLevel: row.skillLevel,
    hourlyTimeValue: row.hourlyTimeValue,
    hasBasicStaples: row.hasBasicStaples,
  };
}

/** Stores the single Settings row in Postgres. */
export class PrismaSettingsStore implements SettingsStore {
  async get(): Promise<UserSettings> {
    const row = await prisma().settings.findUnique({ where: { id: ROW_ID } });
    return row ? toSettings(row) : { ...defaultSettings };
  }

  async update(patch: SettingsUpdate): Promise<UserSettings> {
    const row = await prisma().settings.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...patch },
      update: patch,
    });
    return toSettings(row);
  }
}

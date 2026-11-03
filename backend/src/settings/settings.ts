import { z } from "zod";

export const skillLevels = ["beginner", "average", "confident"] as const;
export type SkillLevel = (typeof skillLevels)[number];

export interface UserSettings {
  addressId: string | null;
  addressLine: string | null;
  defaultServings: number;
  skillLevel: SkillLevel;
  hourlyTimeValue: number;
  hasBasicStaples: boolean;
}

export const defaultSettings: UserSettings = {
  addressId: null,
  addressLine: null,
  defaultServings: 2,
  skillLevel: "average",
  hourlyTimeValue: 200,
  hasBasicStaples: true,
};

/** Body of PUT /api/settings. Every field is optional; only sent fields change. */
export const settingsUpdateSchema = z
  .object({
    addressId: z.string().trim().min(1).max(200).nullable(),
    addressLine: z.string().trim().max(500).nullable(),
    defaultServings: z.number().int().min(1).max(20),
    skillLevel: z.enum(skillLevels),
    hourlyTimeValue: z.number().int().min(0).max(100_000),
    hasBasicStaples: z.boolean(),
  })
  .partial()
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export interface SettingsStore {
  get(): Promise<UserSettings>;
  update(patch: SettingsUpdate): Promise<UserSettings>;
}

/** In-memory store, used by tests. */
export class MemorySettingsStore implements SettingsStore {
  constructor(public value: UserSettings = { ...defaultSettings }) {}
  async get(): Promise<UserSettings> {
    return { ...this.value };
  }
  async update(patch: SettingsUpdate): Promise<UserSettings> {
    this.value = { ...this.value, ...patch };
    return { ...this.value };
  }
}

"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import type { Address, Settings, SkillLevel } from "@/lib/types";

const skillOptions: Array<{ value: SkillLevel; label: string }> = [
  { value: "beginner", label: "Beginner: I follow recipes slowly" },
  { value: "average", label: "Average: I cook a few times a week" },
  { value: "confident", label: "Confident: I cook most days" },
];

const addressText = (a: Address) => (a.line ? `${a.label} — ${a.line}` : a.label);

export function SettingsForm({
  initial,
  connected,
  onSaved,
}: {
  initial: Settings;
  connected: boolean;
  onSaved?: (s: Settings) => void;
}) {
  const [form, setForm] = useState<Settings>(initial);
  // Number fields are edited as text so clearing a field doesn't snap it to a value mid-typing.
  const [servingsText, setServingsText] = useState(String(initial.defaultServings));
  const [hourlyText, setHourlyText] = useState(String(initial.hourlyTimeValue));
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAddresses = useCallback(async () => {
    setLoadingAddresses(true);
    setAddressError(null);
    try {
      const res = await api.getAddresses();
      setAddresses(res.addresses);
      // Preselect Swiggy's suggested address only if none is saved yet.
      setForm((f) => {
        if (f.addressId || !res.defaultAddressId) return f;
        const def = res.addresses.find((a) => a.id === res.defaultAddressId);
        return def ? { ...f, addressId: def.id, addressLine: addressText(def) } : f;
      });
    } catch (err) {
      setAddressError(errorMessage(err));
    } finally {
      setLoadingAddresses(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void loadAddresses();
  }, [connected, loadAddresses]);

  function chooseAddress(id: string) {
    const a = addresses?.find((x) => x.id === id);
    setForm((f) => ({ ...f, addressId: a?.id ?? null, addressLine: a ? addressText(a) : null }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api.saveSettings({
        addressId: form.addressId,
        addressLine: form.addressLine,
        defaultServings: int(servingsText, 1, 20),
        skillLevel: form.skillLevel,
        hourlyTimeValue: int(hourlyText, 0, 100000),
        hasBasicStaples: form.hasBasicStaples,
      });
      setForm(saved);
      setServingsText(String(saved.defaultServings));
      setHourlyText(String(saved.hourlyTimeValue));
      onSaved?.(saved);
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const int = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

  return (
    <form onSubmit={save} className="grid gap-6">
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="address">Delivery address</Label>
          {connected && (
            <Button variant="ghost" size="sm" onClick={() => void loadAddresses()} disabled={loadingAddresses}>
              <RefreshCw className={loadingAddresses ? "animate-spin" : undefined} />
              Refresh
            </Button>
          )}
        </div>
        {!connected ? (
          <p className="text-sm text-muted-foreground">Connect Swiggy to load your saved addresses.</p>
        ) : addressError ? (
          <p className="text-sm text-destructive">{addressError}</p>
        ) : addresses && addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no saved addresses on Swiggy. Add one in the Swiggy app, then refresh.
          </p>
        ) : (
          <NativeSelect
            id="address"
            value={form.addressId ?? ""}
            onChange={(e) => chooseAddress(e.target.value)}
            disabled={!addresses}
          >
            <option value="" disabled>
              {addresses ? "Choose an address" : "Loading addresses…"}
            </option>
            {/* Keep showing the saved address even before the list loads. */}
            {form.addressId && !addresses?.some((a) => a.id === form.addressId) && (
              <option value={form.addressId}>{form.addressLine ?? "Saved address"}</option>
            )}
            {addresses?.map((a) => (
              <option key={a.id} value={a.id}>
                {addressText(a)}
              </option>
            ))}
          </NativeSelect>
        )}
        <p className="text-xs text-muted-foreground">Both Swiggy Food and Instamart are priced for this address.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="servings">Default servings</Label>
          <Input
            id="servings"
            type="number"
            min={1}
            max={20}
            value={servingsText}
            onChange={(e) => setServingsText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Used when your craving doesn&apos;t say how many people.</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="hourly">What an hour of your time is worth (₹)</Label>
          <Input
            id="hourly"
            type="number"
            min={0}
            max={100000}
            step={50}
            value={hourlyText}
            onChange={(e) => setHourlyText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Higher values make ordering look better. 0 means time is free.</p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="skill">Cooking skill</Label>
        <NativeSelect
          id="skill"
          value={form.skillLevel}
          onChange={(e) => setForm((f) => ({ ...f, skillLevel: e.target.value as SkillLevel }))}
        >
          {skillOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">Changes how long cooking takes you and how good it&apos;s likely to be.</p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="grid gap-1">
          <Label htmlFor="staples">I have basic staples</Label>
          <p className="text-xs text-muted-foreground">
            Salt, sugar, oil and common spices aren&apos;t added to the cooking cost.
          </p>
        </div>
        <Switch
          id="staples"
          checked={form.hasBasicStaples}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, hasBasicStaples: checked }))}
        />
      </div>

      <Button type="submit" disabled={saving} className="w-fit">
        {saving && <LoaderCircle className="animate-spin" />}
        Save settings
      </Button>
    </form>
  );
}

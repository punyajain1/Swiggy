"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAppState } from "@/components/app-state";
import { SettingsForm } from "@/components/settings-form";
import { SetupBanner } from "@/components/setup-banner";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsView() {
  const { status, settings, loading, setSettings, refresh } = useAppState();
  const params = useSearchParams();
  const router = useRouter();

  // Messages from the Swiggy login redirect (?connected=1 or ?authError=...).
  useEffect(() => {
    const connected = params.get("connected");
    const authError = params.get("authError");
    if (!connected && !authError) return;
    if (connected) toast.success("Swiggy connected. Now pick your delivery address.");
    if (authError) toast.error(authError);
    void refresh();
    router.replace("/settings");
  }, [params, refresh, router]);

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}>
        <ArrowLeft />
        Back
      </Link>
      {status && !status.connected && <SetupBanner />}
      <Card>
        <CardHeader>
          <CardTitle>Your preferences</CardTitle>
          <CardDescription>
            Shared by every service. Your address is where food is delivered (Cook or Click, and SideQuest&apos;s late-night
            stop). The rest shapes Cook or Click&apos;s comparisons, and your default servings is SideQuest&apos;s group size
            when you don&apos;t say one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !settings ? (
            <div className="grid gap-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : settings ? (
            <SettingsForm
              key={String(status?.connected)}
              initial={settings}
              connected={Boolean(status?.connected)}
              onSaved={setSettings}
            />
          ) : (
            <p className="text-sm text-destructive">Couldn&apos;t load settings. Is the backend running?</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

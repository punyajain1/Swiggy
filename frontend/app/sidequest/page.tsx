"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useAppState } from "@/components/app-state";
import { QuestForm } from "@/components/sidequest/quest-form";
import { QuestProgress } from "@/components/sidequest/quest-progress";
import { QuestResults } from "@/components/sidequest/quest-results";
import { SetupBanner } from "@/components/setup-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, ApiError, errorMessage, isSessionError } from "@/lib/api";
import type { SideQuest } from "@/lib/sidequest-types";

export default function SideQuestPage() {
  const { status, settings, refresh } = useAppState();
  const [quest, setQuest] = useState<SideQuest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [lastText, setLastText] = useState("");

  const ready = Boolean(status?.connected && settings?.addressId);

  async function run(text: string) {
    setLastText(text);
    setLoading(true);
    setError(null);
    setQuest(null);
    try {
      setQuest(await api.sidequest(text));
    } catch (err) {
      setError({ message: errorMessage(err), ...(err instanceof ApiError ? { code: err.code } : {}) });
      if (isSessionError(err)) void refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 sm:gap-8">
      <section className="grid gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Turn a boring evening into an adventure.</h1>
          <p className="max-w-2xl text-sm sm:text-base text-muted-foreground">
            Tell us what you&apos;re planning: a night out, a date, a birthday, a stay-in night, anything. Add your city, crew,
            hours and budget. We pull what&apos;s useful from Swiggy (events on Scenes, tables on Dineout, snacks on Instamart,
            late-night food on Swiggy Food), add free-form ideas, and wrap it all into a mini adventure. Swiggy is the only data
            we use, and the plan works even when it has nothing for you.
          </p>
        </div>
        <SetupBanner />
        <QuestForm onSubmit={(t) => void run(t)} loading={loading} disabled={!ready} />
      </section>

      {loading && <QuestProgress />}

      {error && !loading && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t build that quest</AlertTitle>
          <AlertDescription>
            <p className="break-words">{error.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {error.code === "SWIGGY_RECONNECT" || error.code === "SWIGGY_NOT_CONNECTED" ? (
                <a href={api.loginUrl()} className={buttonVariants({ size: "sm", className: "w-full sm:w-auto" })}>
                  Reconnect Swiggy
                </a>
              ) : error.code === "BAD_REQUEST" || error.code === "NO_ADDRESS" || error.code === "NOTHING_FOUND" ? null : (
                <Button size="sm" variant="outline" onClick={() => void run(lastText)} className="w-full sm:w-auto">
                  <RefreshCw /> Try again
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {quest && !loading && <QuestResults quest={quest} />}
    </div>
  );
}

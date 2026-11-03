"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useAppState } from "@/components/app-state";
import { CravingForm } from "@/components/craving-form";
import { ProgressSteps } from "@/components/progress-steps";
import { DecisionResults } from "@/components/results/decision-results";
import { SetupBanner } from "@/components/setup-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, ApiError, errorMessage, isSessionError } from "@/lib/api";
import type { Decision } from "@/lib/types";

export default function HomePage() {
  const { status, settings, refresh } = useAppState();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [lastText, setLastText] = useState("");

  const ready = Boolean(status?.connected && settings?.addressId);

  async function run(text: string) {
    setLastText(text);
    setLoading(true);
    setError(null);
    setDecision(null);
    try {
      setDecision(await api.decide(text));
    } catch (err) {
      setError({ message: errorMessage(err), ...(err instanceof ApiError ? { code: err.code } : {}) });
      if (isSessionError(err)) void refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Cook it, or click it?</h1>
          <p className="max-w-2xl text-muted-foreground">
            Tell us what you&apos;re craving. We price the ingredients on Instamart, check restaurants on Swiggy Food, and
            show you which is better for you tonight: money, time, effort and ratings.
          </p>
        </div>
        <SetupBanner />
        <CravingForm onSubmit={(t) => void run(t)} loading={loading} disabled={!ready} />
      </section>

      {loading && <ProgressSteps />}

      {error && !loading && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t compare that</AlertTitle>
          <AlertDescription>
            <p>{error.message}</p>
            <div className="mt-2 flex gap-2">
              {error.code === "SWIGGY_RECONNECT" || error.code === "SWIGGY_NOT_CONNECTED" ? (
                <a href={api.loginUrl()} className={buttonVariants({ size: "sm" })}>
                  Reconnect Swiggy
                </a>
              ) : error.code === "BAD_REQUEST" || error.code === "NO_ADDRESS" ? null : (
                <Button size="sm" variant="outline" onClick={() => void run(lastText)}>
                  <RefreshCw /> Try again
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {decision && !loading && <DecisionResults decision={decision} onSessionExpired={() => void refresh()} />}
    </div>
  );
}

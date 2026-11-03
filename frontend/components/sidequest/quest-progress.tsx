"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const steps = [
  "Reading the brief…",
  "Checking what Swiggy has: events, tables, snacks, late-night food…",
  "Dreaming up free-form ideas…",
  "Fitting it all into your time and budget…",
  "Writing your quest…",
];

/** /api/sidequest answers in one response, so the steps advance on a timer and the last one waits. */
export function QuestProgress() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCurrent((c) => Math.min(c + 1, steps.length - 1)), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid gap-6" aria-live="polite">
      <Card>
        <CardContent>
          <ol className="grid gap-3">
            {steps.map((label, i) => (
              <li key={label} className={cn("flex items-start gap-3 text-sm", i > current && "text-muted-foreground/60")}>
                {i < current ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                ) : i === current ? (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-quest" />
                ) : (
                  <span className="mt-0.5 size-4 shrink-0 rounded-full border" />
                )}
                <span className="leading-snug">{label}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Skeleton className="h-32 sm:h-40" />
      <div className="grid gap-4">
        <Skeleton className="h-28 sm:h-32" />
        <Skeleton className="h-28 sm:h-32" />
      </div>
    </div>
  );
}

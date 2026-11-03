"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const steps = [
  "Reading your craving…",
  "Writing a recipe and pricing ingredients on Instamart…",
  "Checking restaurants on Swiggy Food…",
  "Comparing cost, your time and ratings…",
];

/**
 * Shows what the backend is doing while /api/decide runs. The backend answers in one
 * response, so steps advance on a timer and the last one waits for the result.
 */
export function ProgressSteps() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCurrent((c) => Math.min(c + 1, steps.length - 1)), 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid gap-6" aria-live="polite">
      <Card>
        <CardContent>
          <ol className="grid gap-3">
            {steps.map((label, i) => (
              <li key={label} className={cn("flex items-center gap-3 text-sm", i > current && "text-muted-foreground/60")}>
                {i < current ? (
                  <Check className="size-4 text-success" />
                ) : i === current ? (
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="size-4 rounded-full border" />
                )}
                {label}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const examples = [
  "I want butter chicken tonight",
  "Paneer butter masala and dal makhani with butter naan for 6",
  "Veg biryani with raita for 2",
  "Chicken biryani for 6 in an hour",
];

export function CravingForm({
  disabled,
  loading,
  onSubmit,
}: {
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const canSubmit = !disabled && !loading && text.trim().length >= 2;

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(text.trim());
        }}
      >
        <Input
          aria-label="What do you want to eat?"
          placeholder='One dish or a whole meal, e.g. "dal makhani with naan for 4, I have 40 minutes"'
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled || loading}
          className="h-11 sm:h-12 text-sm sm:text-base flex-1"
        />
        <Button type="submit" size="lg" disabled={!canSubmit} className="h-11 sm:h-12 w-full sm:w-auto sm:shrink-0">
          {loading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          Cook or Click?
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled || loading}
            onClick={() => setText(ex)}
            className="rounded-full border bg-card px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50 break-words"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

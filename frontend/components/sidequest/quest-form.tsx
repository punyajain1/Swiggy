"use client";

import { Compass, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const examples = [
  "I have ₹1,000, three friends, and 5 hours. Give us an interesting evening in Delhi.",
  "Plan a night out in Bandra, Mumbai for 4, ₹800 each, from 8pm",
  "Date night in Koramangala, Bengaluru, ₹3,000 for two, something offbeat",
  "Stay-in game night for 5 in Pune, snacks and a late dinner, about 4 hours",
  "Birthday surprise for my friend in Hyderabad, 6 of us, ₹5,000",
];

export function QuestForm({
  disabled,
  loading,
  onSubmit,
}: {
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const canSubmit = !disabled && !loading && text.trim().length >= 5;

  return (
    <div className="grid gap-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(text.trim());
        }}
      >
        <textarea
          aria-label="Describe your evening"
          placeholder='Any plan: a night out, a date, a birthday, a stay-in night. Add the city, crew, hours and budget, e.g. "₹1,000, three friends, 5 hours in Delhi"'
          value={text}
          maxLength={400}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) onSubmit(text.trim());
            }
          }}
          disabled={disabled || loading}
          className="w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-sm sm:text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-quest focus-visible:ring-[3px] focus-visible:ring-quest/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button type="submit" size="lg" disabled={!canSubmit} className="h-11 sm:h-12 w-full bg-quest text-quest-foreground hover:bg-quest/90 sm:w-fit">
          {loading ? <LoaderCircle className="animate-spin" /> : <Compass />}
          Start the quest
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled || loading}
            onClick={() => setText(ex)}
            className="rounded-full border bg-card px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-quest hover:text-foreground disabled:opacity-50 break-words"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

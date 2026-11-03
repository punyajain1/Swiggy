import type * as React from "react";
import { cn } from "@/lib/utils";

/** A styled native <select>: accessible and keyboard-friendly with no extra dependency. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

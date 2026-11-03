import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { services } from "@/components/services";
import { SetupBanner } from "@/components/setup-banner";
import { cn } from "@/lib/utils";

/** The hub: one tile per service, like Swiggy's home screen. */
export default function HubPage() {
  return (
    <div className="grid gap-6 sm:gap-8">
      <section className="grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">What&apos;s the plan tonight?</h1>
        <p className="max-w-2xl text-sm sm:text-base text-muted-foreground">
          Two small helpers on one Swiggy login. Pick one to start.
        </p>
      </section>

      <SetupBanner />

      <section className="grid gap-4 md:grid-cols-2" aria-label="Services">
        {services.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.id}
              href={s.href}
              className={cn(
                "group grid gap-3 sm:gap-4 rounded-2xl border bg-card p-5 sm:p-6 shadow-sm ring-0 ring-transparent transition hover:-translate-y-0.5 hover:shadow-md hover:ring-4 active:scale-[0.99]",
                s.accent.ring,
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <span className={cn("flex size-11 sm:size-12 items-center justify-center rounded-xl", s.accent.bg, s.accent.text)}>
                  <Icon className="size-5 sm:size-6" />
                </span>
                <ArrowRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
              </div>
              <div className="grid gap-1">
                <h2 className="text-lg sm:text-xl font-semibold">{s.name}</h2>
                <p className="font-medium text-sm sm:text-base">{s.tagline}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{s.description}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {s.poweredBy.map((p) => (
                  <span key={p} className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", s.accent.soft)}>
                    {p}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

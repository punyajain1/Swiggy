"use client";

import {
  Bike,
  CalendarClock,
  Check,
  Clock,
  Award,
  Home,
  Info,
  Lightbulb,
  MapPin,
  Moon,
  Route,
  ShoppingBasket,
  Sparkles,
  Star,
  Tag,
  Ticket,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { minutes, rupees, stars } from "@/lib/format";
import type {
  ActivityCandidate,
  ActivityStop,
  DinnerCandidate,
  DinnerStop,
  EventCandidate,
  EventStop,
  LateNightCandidate,
  LateNightStop,
  CoverageStatus,
  QuestChapter,
  ServiceCoverage,
  SideQuest,
  SuppliesStop,
  TableSlot,
} from "@/lib/sidequest-types";
import { cn } from "@/lib/utils";

const KIND = {
  event: { icon: Ticket, source: "Scenes" },
  dinner: { icon: UtensilsCrossed, source: "Dineout" },
  lateNight: { icon: Moon, source: "Swiggy Food" },
  supplies: { icon: ShoppingBasket, source: "Instamart" },
  activity: { icon: Lightbulb, source: "Idea" },
} as const;

function ratingCount(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K ratings`;
  return `${n} rating${n === 1 ? "" : "s"}`;
}

/** The finished quest: the story header, one chapter per stop, the budget and a Plan B. */
export function QuestResults({ quest }: { quest: SideQuest }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="grid gap-6">
      <QuestHero quest={quest} completed={done.size} />
      <CoveragePanel coverage={quest.coverage} />

      {quest.warnings.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {quest.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-label="Chapters" className="grid min-w-0 gap-0">
          <ol className="grid">
            {quest.chapters.map((c, i) => (
              <li key={c.index} className="relative grid grid-cols-[2rem_1fr] sm:grid-cols-[2.5rem_1fr] gap-x-2.5 sm:gap-x-4">
                {/* Rail */}
                <div className="flex flex-col items-center">
                  {c.travelBeforeMin > 0 && <span className="h-12 sm:h-14 w-px border-l-2 border-dashed border-quest/40" aria-hidden />}
                  <span className="flex size-8 sm:size-10 shrink-0 items-center justify-center rounded-full bg-quest text-xs sm:text-base font-bold text-quest-foreground">
                    {i + 1}
                  </span>
                  {i < quest.chapters.length - 1 && <span className="w-px flex-1 border-l-2 border-dashed border-quest/40" aria-hidden />}
                </div>
                <div className="grid min-w-0 pb-6">
                  {c.travelBeforeMin > 0 && (
                    <p className="flex h-12 sm:h-14 items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground break-words">
                      <Route className="size-3.5 shrink-0" /> About {minutes(c.travelBeforeMin)} to get there (estimate)
                    </p>
                  )}
                  <ChapterCard chapter={c} done={done.has(c.index)} onToggle={() => toggle(c.index)} />
                </div>
              </li>
            ))}
          </ol>
          <Card className="border-quest/30 bg-quest-muted">
            <CardContent className="flex items-start gap-3 p-4 sm:p-5">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-quest" />
              <div className="grid min-w-0 gap-1">
                <p className="text-sm font-semibold">Finale</p>
                <p className="text-xs sm:text-sm break-words">{quest.story.finale}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="grid gap-6 lg:sticky lg:top-24">
          <BudgetCard quest={quest} />
          <PlanB quest={quest} />
        </aside>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground break-words">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        SideQuest doesn&apos;t book anything. Book the table on Dineout, tickets on Scenes and place the Instamart and food
        orders in the Swiggy app. Stops tagged &quot;Idea&quot; are AI suggestions, not Swiggy listings. Times between stops are
        estimates.
      </p>
    </div>
  );
}

const STATUS: Record<CoverageStatus, { label: string; dot: string; text: string }> = {
  used: { label: "In your quest", dot: "bg-success", text: "text-success" },
  left_out: { label: "Left out", dot: "bg-warning", text: "text-warning" },
  nothing_found: { label: "Nothing found", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  unavailable: { label: "Unavailable", dot: "bg-destructive", text: "text-destructive" },
  not_needed: { label: "Not needed", dot: "bg-muted-foreground/30", text: "text-muted-foreground" },
};

/** One tile per Swiggy service: used, or why it wasn't. */
function CoveragePanel({ coverage }: { coverage: ServiceCoverage[] }) {
  if (!coverage?.length) return null;
  return (
    <section aria-label="Swiggy services used" data-testid="coverage" className="grid gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What Swiggy added</h3>
      <ul className="grid gap-2.5 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {coverage.map((c) => {
          const s = STATUS[c.status] ?? STATUS.nothing_found;
          return (
            <li key={c.service} data-testid={`coverage-${c.service}`} className="grid gap-1 rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm sm:text-base">{c.service}</span>
                <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", s.text)}>
                  <span className={cn("size-2 rounded-full", s.dot)} aria-hidden /> {s.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {c.role}: {c.note}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuestHero({ quest, completed }: { quest: SideQuest; completed: number }) {
  const r = quest.request;
  const chips = [
    { icon: MapPin, text: r.area ? `${r.area}, ${r.city}` : r.city },
    ...(r.theme ? [{ icon: Sparkles, text: r.theme }] : []),
    { icon: Users, text: `Party of ${r.people}` },
    { icon: CalendarClock, text: `${r.startLabel} – ${r.endLabel}` },
    ...(r.budgetRs !== null ? [{ icon: Wallet, text: `${rupees(r.budgetRs)} budget` }] : []),
  ];
  return (
    <section
      aria-label="Your quest"
      className="grid gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-quest to-[oklch(0.35_0.15_285)] p-4 sm:p-6 text-quest-foreground shadow-md"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="text-xs font-medium uppercase tracking-widest opacity-80">Side quest unlocked</p>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight break-words">{quest.story.title}</h2>
          <p className="max-w-2xl text-xs sm:text-sm opacity-90 break-words">{quest.story.tagline}</p>
        </div>
        <div className="self-start shrink-0 rounded-xl bg-white/15 px-3 py-2 text-center" aria-label="Side challenges completed">
          <p className="text-xl sm:text-2xl font-bold tabular-nums">
            {completed}/{quest.chapters.length}
          </p>
          <p className="text-xs opacity-80">side challenges</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {chips.map(({ icon: Icon, text }) => (
          <span key={text} className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 sm:px-3 py-1 text-xs font-medium">
            <Icon className="size-3.5 shrink-0" /> <span className="break-words">{text}</span>
          </span>
        ))}
        {r.vibe.map((v) => (
          <span key={v} className="rounded-full border border-white/30 px-2.5 sm:px-3 py-1 text-xs break-words">
            {v}
          </span>
        ))}
      </div>
      {r.assumptions.length > 0 && <p className="text-xs opacity-80 break-words">We assumed: {r.assumptions.join(" ")}</p>}
    </section>
  );
}

function ChapterCard({ chapter: c, done, onToggle }: { chapter: QuestChapter; done: boolean; onToggle: () => void }) {
  // The backend can gain stop kinds before this table does; show a plain card instead of crashing.
  const meta: { icon: typeof Sparkles; source: string } = (KIND as Record<string, (typeof KIND)[keyof typeof KIND]>)[c.stop.kind] ?? {
    icon: Sparkles,
    source: "Swiggy",
  };
  const Icon = meta.icon;
  return (
    <Card data-testid={`chapter-${c.stop.kind}`} className="gap-3 sm:gap-4 py-4 sm:py-5 min-w-0 overflow-hidden">
      <CardHeader className="gap-1.5 sm:gap-2 px-3.5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          <span className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium uppercase tracking-wide text-quest">
            <Icon className="size-3.5 sm:size-4 shrink-0" /> Chapter {c.index + 1} · {c.startLabel} – {c.endLabel}
          </span>
          <Badge
            variant={c.stop.kind === "activity" ? "secondary" : "outline"}
            title={c.stop.kind === "activity" ? "A suggestion written by the AI, not a listing from Swiggy" : `Data from Swiggy ${meta.source}`}
          >
            {meta.source}
          </Badge>
        </div>
        <CardTitle className="text-lg sm:text-xl break-words">{c.title}</CardTitle>
        <CardDescription className="italic break-words text-xs sm:text-sm">{c.flavor}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:gap-4 px-3.5 sm:px-5">
        {c.stop.kind === "event" && <EventDetails stop={c.stop} />}
        {c.stop.kind === "dinner" && <DinnerDetails stop={c.stop} />}
        {c.stop.kind === "lateNight" && <LateNightDetails stop={c.stop} />}
        {c.stop.kind === "activity" && <ActivityDetails stop={c.stop} />}
        {c.stop.kind === "supplies" && <SuppliesDetails stop={c.stop} />}

        <button
          type="button"
          onClick={onToggle}
          aria-pressed={done}
          className={cn(
            "flex items-start gap-2.5 sm:gap-3 rounded-lg border border-dashed p-2.5 sm:p-3 text-left text-xs sm:text-sm transition-colors",
            done ? "border-success/50 bg-success/10" : "border-quest/40 bg-quest-muted hover:border-quest",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-4.5 sm:size-5 shrink-0 items-center justify-center rounded border",
              done ? "border-success bg-success text-white" : "border-quest/60 bg-card",
            )}
          >
            {done && <Check className="size-3 sm:size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-quest">Side challenge</span>
            <span className={cn("break-words", done && "line-through opacity-70")}>{c.challenge}</span>
          </span>
        </button>
      </CardContent>
    </Card>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-muted-foreground">{children}</div>;
}

function Fact({ icon: Icon, children, className }: { icon: typeof Star; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <Icon className="size-3 shrink-0" /> <span className="break-words">{children}</span>
    </span>
  );
}

function eventPrice(e: EventCandidate): string {
  if (e.groupCostRs === null) return "Price not listed";
  if (e.groupCostRs === 0) return "Free";
  return `${rupees(e.groupCostRs)} for the group${e.pricePerPersonRs ? ` (${rupees(e.pricePerPersonRs)} each)` : ""}`;
}

function EventDetails({ stop: e }: { stop: EventStop }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base break-words">{e.name}</p>
          <p className="text-xs sm:text-sm text-muted-foreground break-words">{[e.venueName, e.area].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{e.costRs ? rupees(e.costRs) : eventPrice(e)}</p>
          {e.costRs ? <p className="text-xs text-muted-foreground tabular-nums">{e.pricePerPersonRs ? `${rupees(e.pricePerPersonRs)} each` : null}</p> : null}
        </div>
      </div>
      <Facts>
        <Fact icon={CalendarClock}>{e.showTimeLabel}</Fact>
        <Fact icon={Clock}>
          {minutes(e.durationMin)}
          {e.durationEstimated ? " (est.)" : ""}
        </Fact>
        {e.ticketTitle && <Fact icon={Ticket}>{e.ticketTitle}</Fact>}
        {e.seatsLeft !== null && e.seatsLeft <= 20 && <Fact icon={Users} className="text-warning">Only {e.seatsLeft} seats left</Fact>}
        {e.genre && <span>{e.genre}</span>}
        {e.language && <span>{e.language}</span>}
      </Facts>
    </div>
  );
}

function slotText(slot: TableSlot): { text: string; tone: "ok" | "warn" | "muted" } {
  if (slot.status === "free") return { text: `Free table booking at ${slot.displayTime}${slot.openRanges ? ` · tables ${slot.openRanges}` : ""}`, tone: "ok" };
  if (slot.status === "paid") {
    const price = slot.bookingPriceRs ? ` with a ${rupees(slot.bookingPriceRs)} prebook deal` : " with a paid prebook deal";
    return { text: `Table at ${slot.displayTime}${price}${slot.dealTitle ? ` (${slot.dealTitle})` : ""}`, tone: "ok" };
  }
  if (slot.status === "none") {
    const hours = slot.openRanges ? ` Tables are taken ${slot.openRanges}.` : "";
    return { text: `Dineout lists no tables at this time.${hours} Pick another time on Dineout.`, tone: "warn" };
  }
  return { text: "Couldn't check table slots. Check on Dineout before you go.", tone: "muted" };
}

function DinnerDetails({ stop: d }: { stop: DinnerStop }) {
  const slot = slotText(d.slot);
  const count = ratingCount(d.ratingCount);
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 sm:gap-2 font-semibold text-sm sm:text-base break-words">
            <span>{d.name}</span>
            {d.badge && (
              <Badge variant="success">
                <Award /> {d.badge}
              </Badge>
            )}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground break-words">{[d.cuisines.slice(0, 3).join(", "), d.locality].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{rupees(d.costRs)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {rupees(d.costForTwoRs)} for two{d.costForTwoKnown ? "" : " (guess)"} · est.
          </p>
        </div>
      </div>
      <Facts>
        {d.rating !== null && (
          <Fact icon={Star}>
            {stars(d.rating)}
            {count ? ` (${count})` : ""}
          </Fact>
        )}
        {d.distanceKm !== null && <Fact icon={MapPin}>{d.distanceKm.toFixed(1)} km away</Fact>}
        {d.offers.map((o) => (
          <Fact key={o} icon={Tag} className="text-primary">
            {o}
          </Fact>
        ))}
      </Facts>
      {d.highlights.length > 0 && <p className="text-xs text-muted-foreground break-words">{d.highlights.join(" · ")}</p>}
      <p
        className={cn(
          "text-xs sm:text-sm break-words",
          slot.tone === "ok" && "text-success",
          slot.tone === "warn" && "text-warning",
          slot.tone === "muted" && "text-muted-foreground",
        )}
      >
        {slot.text}
      </p>
    </div>
  );
}

function LateNightDetails({ stop: f }: { stop: LateNightStop }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base break-words">
            {f.quantity} × {f.dish}
            {f.isVeg === true && <span className="ml-1 text-xs sm:text-sm font-normal text-success">· veg</span>}
            {f.shared && <span className="ml-1 text-xs sm:text-sm font-normal text-muted-foreground">· to share</span>}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground break-words">{f.restaurantName}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{rupees(f.costRs)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {rupees(f.itemTotalRs)} + {rupees(f.feesRs)} fees · est.
          </p>
        </div>
      </div>
      <Facts>
        {f.shared && <Fact icon={Users}>One portion per two people</Fact>}
        <Fact icon={Bike}>Order at {f.orderAtLabel} as you head home</Fact>
        {f.rating !== null && <Fact icon={Star}>{stars(f.rating)}</Fact>}
      </Facts>
      <p className="text-xs text-muted-foreground">Check it&apos;s still open when you order; late-night menus change.</p>
    </div>
  );
}

function ActivityDetails({ stop: a }: { stop: ActivityStop }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base break-words">{a.title}</p>
          <p className="text-xs sm:text-sm text-muted-foreground break-words">{a.what}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{a.costRs === 0 ? "Free" : rupees(a.costRs)}</p>
          {a.costRs > 0 && <p className="text-xs text-muted-foreground tabular-nums">{rupees(a.costPerPersonRs)} each · guess</p>}
        </div>
      </div>
      <Facts>
        <Fact icon={Clock}>{minutes(a.durationMin)}</Fact>
        <Fact icon={a.where === "home" ? Home : MapPin}>{a.where === "home" ? "At home" : "Out and about"}</Fact>
      </Facts>
      <p className="text-xs text-muted-foreground">
        An idea, not a Swiggy listing: no venue, hours or price is checked. Pick a spot you like.
      </p>
    </div>
  );
}

function SuppliesDetails({ stop: s }: { stop: SuppliesStop }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base">Instamart order</p>
          <p className="text-xs sm:text-sm text-muted-foreground break-words">Order before you head out. Prices are from Instamart.</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{rupees(s.costRs)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {rupees(s.itemTotalRs)} + {rupees(s.feesRs)} fees · est.
          </p>
        </div>
      </div>
      <ul className="grid gap-1.5 sm:gap-1 text-xs sm:text-sm">
        {s.lines.map((l) => (
          <li key={l.want} className="flex items-start justify-between gap-2 sm:gap-3">
            <span className="min-w-0 flex-1 break-words">
              {l.quantity} × {l.name}
              {l.pack ? <span className="text-xs text-muted-foreground"> · {l.pack}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{rupees(l.lineRs)}</span>
          </li>
        ))}
      </ul>
      {s.missing.length > 0 && <p className="text-xs text-warning break-words">Not found on Instamart near you: {s.missing.join(", ")}.</p>}
    </div>
  );
}

function BudgetCard({ quest }: { quest: SideQuest }) {
  const b = quest.budget;
  const share = b.limitRs ? Math.min(100, Math.round((b.totalRs / b.limitRs) * 100)) : null;
  return (
    <Card data-testid="budget-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-5" /> Budget
        </CardTitle>
        <CardDescription>For the whole group. All amounts are estimates.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums">{rupees(b.totalRs)}</span>
            {b.limitRs !== null && <span className="text-sm text-muted-foreground">of {rupees(b.limitRs)}</span>}
          </div>
          {share !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
              <div className={cn("h-full rounded-full", b.overByRs ? "bg-warning" : "bg-success")} style={{ width: `${share}%` }} />
            </div>
          )}
          <p className={cn("text-xs sm:text-sm break-words", b.overByRs ? "text-warning" : "text-muted-foreground")}>
            {b.overByRs
              ? `${rupees(b.overByRs)} over budget`
              : b.limitRs !== null
                ? `${rupees(b.limitRs - b.totalRs)} to spare`
                : "No budget given"}
            {" · "}
            {rupees(b.perPersonRs)} each
          </p>
        </div>
        <ul className="grid gap-2 text-xs sm:text-sm">
          {b.lines.map((l) => (
            <li key={l.label} className="flex items-start justify-between gap-2 sm:gap-3">
              <span className="min-w-0 flex-1 break-words text-muted-foreground">{l.label}</span>
              <span className="shrink-0 tabular-nums">
                {l.costRs === 0 ? "Free" : rupees(l.costRs)}
                {l.estimated && l.costRs > 0 ? <span className="text-xs text-muted-foreground"> est.</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PlanB({ quest }: { quest: SideQuest }) {
  const { events, dinners, lateNight, activities } = quest.alternatives;
  if (events.length + dinners.length + lateNight.length + activities.length === 0) return null;
  return (
    <Card data-testid="plan-b">
      <CardHeader>
        <CardTitle>Plan B</CardTitle>
        <CardDescription>Other good options if a stop is full or closed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-xs sm:text-sm">
        {events.length > 0 && (
          <AltGroup title="Events" items={events.map((e: EventCandidate) => ({
            key: `${e.eventId}-${e.showStartMs}`,
            name: e.name,
            detail: [e.venueName, e.showTimeLabel, eventPrice(e)].filter(Boolean).join(" · "),
          }))} />
        )}
        {dinners.length > 0 && (
          <AltGroup title="Dinner" items={dinners.map((d: DinnerCandidate) => ({
            key: d.restaurantId,
            name: `${d.name}${d.badge ? ` · ${d.badge}` : ""}`,
            detail: [stars(d.rating ?? undefined), `${rupees(d.costForTwoRs)} for two`, d.locality].filter(Boolean).join(" · "),
          }))} />
        )}
        {activities.length > 0 && (
          <AltGroup title="Ideas" items={activities.map((a: ActivityCandidate) => ({
            key: a.id,
            name: a.title,
            detail: [a.where === "home" ? "At home" : "Out and about", minutes(a.durationMin), a.costPerPersonRs ? `${rupees(a.costPerPersonRs)} each` : "Free"].join(" · "),
          }))} />
        )}
        {lateNight.length > 0 && (
          <AltGroup title="Late night" items={lateNight.map((f: LateNightCandidate) => ({
            key: `${f.restaurantName}-${f.dish}`,
            name: f.dish,
            detail: [f.restaurantName, `${rupees(f.pricePerItemRs)} each`, stars(f.rating ?? undefined)].filter(Boolean).join(" · "),
          }))} />
        )}
      </CardContent>
    </Card>
  );
}

function AltGroup({ title, items }: { title: string; items: Array<{ key: string; name: string; detail: string }> }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.key}>
            <p className="font-medium break-words">{i.name}</p>
            <p className="text-xs text-muted-foreground break-words">{i.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

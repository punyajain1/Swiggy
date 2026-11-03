"use client";

import { LogOut, MoonStar, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppState } from "./app-state";
import { serviceForPath, services } from "./services";

export function Header() {
  const { status, refresh } = useAppState();
  const pathname = usePathname();
  const active = serviceForPath(pathname);

  async function logout() {
    try {
      await api.logout();
      toast.success("Disconnected from Swiggy.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <MoonStar className="size-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-lg tracking-wide">OFFSCRIPT</span>
            <span className="hidden text-xs font-normal text-muted-foreground sm:block">Make plans. Break routines.</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Account">
          {status?.connected ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
              <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
              <span className="hidden sm:inline">Swiggy connected</span>
              <span className="sm:hidden">Connected</span>
            </span>
          ) : status ? (
            <a href={api.loginUrl()} className={cn(buttonVariants({ size: "sm" }), "shrink-0 text-xs sm:text-sm px-2.5 sm:px-3")}>
              {status.needsReconnect ? "Reconnect" : "Connect"}
              <span className="hidden sm:inline"> Swiggy</span>
            </a>
          ) : null}

          <Link href="/settings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <SettingsIcon />
            <span className="hidden sm:inline">Settings</span>
          </Link>

          {status?.connected && (
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Disconnect Swiggy">
              <LogOut />
            </Button>
          )}
        </nav>
      </div>

      {/* Service switcher, like the service tabs at the top of the Swiggy app. */}
      <nav aria-label="Services" className="no-scrollbar mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6 lg:px-8">
        {services.map((s) => {
          const isActive = active?.id === s.id;
          const Icon = s.icon;
          return (
            <Link
              key={s.id}
              href={s.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive ? cn(s.accent.bg, s.accent.text, "border-transparent") : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {s.name}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

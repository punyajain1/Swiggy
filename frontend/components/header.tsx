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
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <MoonStar className="size-5" />
          </span>
          <span className="text-lg">Tonight</span>
        </Link>

        <nav className="flex items-center gap-2" aria-label="Account">
          {status?.connected ? (
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              Swiggy connected
            </span>
          ) : status ? (
            <a href={api.loginUrl()} className={buttonVariants({ size: "sm" })}>
              {status.needsReconnect ? "Reconnect Swiggy" : "Connect Swiggy"}
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
      <nav aria-label="Services" className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3">
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

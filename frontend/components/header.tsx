"use client";

import { ChefHat, LogOut, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppState } from "./app-state";

export function Header() {
  const { status, refresh } = useAppState();

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
    <header className="border-b bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChefHat className="size-5" />
          </span>
          <span className="text-lg">Cook or Click</span>
        </Link>

        <nav className="flex items-center gap-2">
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
    </header>
  );
}

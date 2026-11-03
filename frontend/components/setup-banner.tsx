"use client";

import { MapPin, PlugZap, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAppState } from "./app-state";

/** Tells the user what's missing (Swiggy login or an address) before any service can run. Renders nothing when ready. */
export function SetupBanner() {
  const { status, settings, error } = useAppState();

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Can&apos;t reach the backend</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription>
      </Alert>
    );
  }
  if (!status || !settings) return null;

  if (!status.connected) {
    return (
      <Alert variant="warning">
        <PlugZap />
        <AlertTitle>{status.needsReconnect ? "Your Swiggy session expired" : "Connect your Swiggy account"}</AlertTitle>
        <AlertDescription>
          <p className="break-words">
            Every service here reads live data from Swiggy (Food, Instamart, Dineout and Scenes) with one login. You log in on
            Swiggy with your phone and an OTP.
          </p>
          <a href={api.loginUrl()} className={buttonVariants({ size: "sm", className: "mt-2 w-full sm:w-fit" })}>
            {status.needsReconnect ? "Reconnect Swiggy" : "Connect Swiggy"}
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  if (!settings.addressId) {
    return (
      <Alert variant="warning">
        <MapPin />
        <AlertTitle>Pick a delivery address</AlertTitle>
        <AlertDescription>
          <p className="break-words">Prices and delivery times depend on where you are.</p>
          <Link href="/settings" className={buttonVariants({ size: "sm", className: "mt-2 w-full sm:w-fit" })}>
            Choose address
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

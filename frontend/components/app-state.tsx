"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { AuthStatus, Settings } from "@/lib/types";

interface AppState {
  status: AuthStatus | null;
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setSettings: (s: Settings) => void;
}

const AppStateContext = createContext<AppState | null>(null);

/** Swiggy connection status and saved settings, shared by the header, home and settings pages. */
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([api.authStatus(), api.getSettings()]);
      setStatus(s);
      setSettings(st);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, settings, loading, error, refresh, setSettings }),
    [status, settings, loading, error, refresh],
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside <AppStateProvider>");
  return value;
}

import { Suspense } from "react";
import { SettingsView } from "./settings-view";

export const metadata = { title: "Settings · Cook or Click" };

export default function SettingsPage() {
  return (
    // useSearchParams() inside SettingsView needs a Suspense boundary.
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}

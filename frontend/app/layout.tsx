import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppStateProvider } from "@/components/app-state";
import { Header } from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tonight", template: "%s · Tonight" },
  description: "Cook or Click and SideQuest: two Swiggy-powered helpers for tonight's food and plans.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppStateProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground">
            Powered by Swiggy MCP and Groq. Prices are estimates until Swiggy shows the real bill. This app never places
            orders, books tables or buys tickets.
          </footer>
        </AppStateProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}

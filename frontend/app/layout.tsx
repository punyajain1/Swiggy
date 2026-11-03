import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { AppStateProvider } from "@/components/app-state";
import { Header } from "@/components/header";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: { default: "OFFSCRIPT · Make plans. Break routines.", template: "%s · OFFSCRIPT" },
  description: "Make plans. Break routines. Cook or Click and SideQuest: two Swiggy-powered helpers for tonight's food and plans.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppStateProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground sm:px-6 lg:px-8">
            Powered by Swiggy MCP and Groq. Prices are estimates until Swiggy shows the real bill. This app never places
            orders, books tables or buys tickets.
          </footer>
        </AppStateProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}

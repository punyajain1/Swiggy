import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppStateProvider } from "@/components/app-state";
import { Header } from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cook or Click",
  description: "Should you cook or order? Compares Swiggy Food restaurants with cooking from Swiggy Instamart ingredients.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppStateProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground">
            Powered by Swiggy MCP and Groq. Prices before &quot;Fill cart&quot; are estimates. Cook or Click never places orders.
          </footer>
        </AppStateProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cook or Click",
  description: "Should you cook or order? Compares Swiggy Food restaurants with cooking from Swiggy Instamart ingredients.",
};

export default function CookOrClickLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

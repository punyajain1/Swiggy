import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SideQuest",
  description: "Turn a boring evening into an adventure: an event from Swiggy Scenes, dinner from Dineout and late-night food from Swiggy Food.",
};

export default function SideQuestLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

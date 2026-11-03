import { ChefHat, Compass, type LucideIcon } from "lucide-react";

export interface Service {
  id: "cook-or-click" | "sidequest";
  name: string;
  href: string;
  /** One line for the tiles on the home page. */
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** Swiggy services this one reads from. */
  poweredBy: string[];
  /** Tailwind classes for the service's accent colour. */
  accent: { bg: string; text: string; soft: string; ring: string };
}

/** The services in this app, like the tiles on Swiggy's home screen. Add a new one here and it shows up everywhere. */
export const services: Service[] = [
  {
    id: "cook-or-click",
    name: "Cook or Click",
    href: "/cook-or-click",
    tagline: "Cook it at home, or order in?",
    description: "Type a craving. We price the ingredients on Instamart, check restaurants on Swiggy Food, and tell you which is better tonight.",
    icon: ChefHat,
    poweredBy: ["Swiggy Food", "Instamart"],
    accent: { bg: "bg-primary", text: "text-primary-foreground", soft: "bg-accent", ring: "hover:ring-primary/40" },
  },
  {
    id: "sidequest",
    name: "SideQuest",
    href: "/sidequest",
    tagline: "Turn a boring evening into an adventure.",
    description: "Plan a night out, a date, a birthday or a stay-in night. We mix real Swiggy picks with free-form ideas into a mini adventure that fits your hours and budget.",
    icon: Compass,
    poweredBy: ["Scenes", "Dineout", "Swiggy Food", "Instamart"],
    accent: { bg: "bg-quest", text: "text-quest-foreground", soft: "bg-quest-muted", ring: "hover:ring-quest/40" },
  },
];

export function serviceForPath(pathname: string): Service | undefined {
  return services.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}

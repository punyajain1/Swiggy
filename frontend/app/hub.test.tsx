import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HubPage from "./page";

vi.mock("@/components/setup-banner", () => ({ SetupBanner: () => null }));

describe("hub", () => {
  it("links to both services", () => {
    render(<HubPage />);
    expect(screen.getByRole("link", { name: /Cook or Click/ })).toHaveAttribute("href", "/cook-or-click");
    expect(screen.getByRole("link", { name: /SideQuest/ })).toHaveAttribute("href", "/sidequest");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { SettingsForm } from "./settings-form";

vi.mock("@/lib/api", () => ({
  api: { getAddresses: vi.fn(), saveSettings: vi.fn() },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const initial: Settings = {
  addressId: null,
  addressLine: null,
  defaultServings: 2,
  skillLevel: "average",
  hourlyTimeValue: 200,
  hasBasicStaples: true,
};

beforeEach(() => {
  vi.mocked(api.getAddresses).mockReset().mockResolvedValue({
    addresses: [
      { id: "a1", label: "Home", line: "12 MG Road" },
      { id: "a2", label: "Work", line: "Outer Ring Road" },
    ],
    defaultAddressId: null,
  });
  vi.mocked(api.saveSettings)
    .mockReset()
    .mockImplementation(async (patch) => ({ ...initial, ...patch }));
});

describe("SettingsForm", () => {
  it("loads addresses and saves preferences through the API", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<SettingsForm initial={initial} connected onSaved={onSaved} />);

    const address = screen.getByLabelText("Delivery address");
    await screen.findByRole("option", { name: "Work — Outer Ring Road" });
    await user.selectOptions(address, "a2");

    const servings = screen.getByLabelText("Default servings");
    await user.clear(servings);
    await user.type(servings, "4");

    await user.selectOptions(screen.getByLabelText("Cooking skill"), "confident");
    await user.click(screen.getByRole("switch", { name: "I have basic staples" }));
    await user.click(screen.getByRole("button", { name: /Save settings/ }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        addressId: "a2",
        addressLine: "Work — Outer Ring Road",
        defaultServings: 4,
        skillLevel: "confident",
        hourlyTimeValue: 200,
        hasBasicStaples: false,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ defaultServings: 4, addressId: "a2" }));
  });

  it("preselects Swiggy's suggested address when none is saved", async () => {
    vi.mocked(api.getAddresses).mockResolvedValueOnce({
      addresses: [{ id: "a1", label: "Home", line: "12 MG Road" }],
      defaultAddressId: "a1",
    });
    render(<SettingsForm initial={initial} connected />);
    await waitFor(() => expect(screen.getByLabelText("Delivery address")).toHaveValue("a1"));
  });

  it("doesn't load addresses before Swiggy is connected", () => {
    render(<SettingsForm initial={initial} connected={false} />);
    expect(api.getAddresses).not.toHaveBeenCalled();
    expect(screen.getByText(/Connect Swiggy to load your saved addresses/)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  it("renders light state and reports the click origin", () => {
    const onToggle = vi.fn();

    render(
      <ThemeToggle currentTheme="light" nextTheme="dark" onToggle={onToggle} />,
    );

    const button = screen.getByRole("button", { name: "切换到 Dark" });
    button.getBoundingClientRect = vi.fn(
      () =>
        ({
          x: 10,
          y: 20,
          left: 10,
          top: 20,
          width: 80,
          height: 40,
          right: 90,
          bottom: 60,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    );

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Light")).not.toBeNull();

    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledWith({ x: 50, y: 40 });
  });

  it("renders dark state with the next light label", () => {
    render(
      <ThemeToggle currentTheme="dark" nextTheme="light" onToggle={vi.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: "切换到 Light" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Dark")).not.toBeNull();
  });
});

export interface ThemeToggleProps {
  currentTheme: "light" | "dark";
  nextTheme: "light" | "dark";
  onToggle: () => void;
}

export function ThemeToggle({
  currentTheme,
  nextTheme,
  onToggle,
}: ThemeToggleProps) {
  const switchLabel =
    nextTheme === "light" ? "切换到浅色主题" : "切换到深色主题";

  return (
    <button
      aria-label={switchLabel}
      aria-pressed={currentTheme === "dark"}
      className="theme-toggle"
      onClick={onToggle}
      title={switchLabel}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle__icon">
        {currentTheme === "dark" ? "☾" : "☼"}
      </span>
      <span className="theme-toggle__label">
        {currentTheme === "dark" ? "深色" : "浅色"}
      </span>
    </button>
  );
}

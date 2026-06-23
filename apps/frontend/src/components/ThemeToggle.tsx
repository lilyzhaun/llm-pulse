export interface ThemeToggleProps {
  currentTheme: "light" | "dark";
  nextTheme: "light" | "dark";
  onToggle: (origin?: { x: number; y: number }) => void;
}

export function ThemeToggle({
  currentTheme,
  nextTheme,
  onToggle,
}: ThemeToggleProps) {
  const switchLabel = nextTheme === "light" ? "切换到 Light" : "切换到 Dark";

  return (
    <button
      aria-label={switchLabel}
      aria-pressed={currentTheme === "dark"}
      className="theme-toggle"
      onClick={(event) => {
        const target = event.currentTarget.getBoundingClientRect();
        onToggle({
          x: target.left + target.width / 2,
          y: target.top + target.height / 2,
        });
      }}
      title={switchLabel}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle__icon">
        <span
          className={
            currentTheme === "dark"
              ? "theme-toggle__icon-active"
              : "theme-toggle__icon-inactive"
          }
        >
          ☾
        </span>
        <span
          className={
            currentTheme === "light"
              ? "theme-toggle__icon-active"
              : "theme-toggle__icon-inactive"
          }
        >
          ☼
        </span>
      </span>
      <span className="theme-toggle__label">
        {currentTheme === "dark" ? "Dark" : "Light"}
      </span>
    </button>
  );
}

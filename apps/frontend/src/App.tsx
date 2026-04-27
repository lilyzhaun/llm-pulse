import { useEffect, useState } from "react";
import { ThemeToggle } from "./components/ThemeToggle";
import { Dashboard } from "./pages/Dashboard";

const THEME_STORAGE_KEY = "llm-pulse-theme-preference";

type ThemeMode = "light" | "dark";

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredThemePreference(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);

    return storedValue === "light" || storedValue === "dark"
      ? storedValue
      : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function App() {
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() =>
    getSystemTheme(),
  );
  const [themePreference, setThemePreference] = useState<ThemeMode | null>(() =>
    getStoredThemePreference(),
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const resolvedTheme = themePreference ?? systemTheme;
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      if (themePreference) {
        window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
        return;
      }

      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // 忽略浏览器存储异常，保持界面可用。
    }
  }, [themePreference]);

  return (
    <>
      <Dashboard />
      <ThemeToggle
        currentTheme={resolvedTheme}
        nextTheme={nextTheme}
        onToggle={() => setThemePreference(nextTheme)}
      />
    </>
  );
}

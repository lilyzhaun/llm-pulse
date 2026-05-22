import { useEffect, useRef, useState } from "react";
import { HeartbeatSlotProvider } from "./contexts/HeartbeatSlotContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { Dashboard } from "./pages/Dashboard";

const THEME_STORAGE_KEY = "llm-pulse-theme-preference";
const THEME_COLORS: Record<ThemeMode, string> = {
  light: "#faf9f5",
  dark: "#141413",
};

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

type ViewTransitionHandle = {
  ready: Promise<void>;
  finished: Promise<void>;
};

type DocumentWithViewTransitions = Document & {
  startViewTransition?: (
    callback: () => void | Promise<void>,
  ) => ViewTransitionHandle;
};

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

interface RippleOrigin {
  x: number;
  y: number;
}

function applyThemeWithTransition(
  theme: ThemeMode,
  origin: RippleOrigin | undefined,
  commit: () => void,
) {
  const documentWithViewTransitions = document as DocumentWithViewTransitions;
  const startViewTransition =
    documentWithViewTransitions.startViewTransition?.bind(
      documentWithViewTransitions,
    );

  if (
    !startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    applyTheme(theme);
    commit();
    return;
  }

  const root = document.documentElement;
  const originX = origin?.x ?? window.innerWidth / 2;
  const originY = origin?.y ?? window.innerHeight / 2;
  const maxRadius = Math.hypot(
    Math.max(originX, window.innerWidth - originX),
    Math.max(originY, window.innerHeight - originY),
  );

  root.style.setProperty("--theme-ripple-x", `${originX}px`);
  root.style.setProperty("--theme-ripple-y", `${originY}px`);
  root.style.setProperty("--theme-ripple-radius", `${maxRadius}px`);
  root.dataset.themeTransition = "ripple";

  const transition = startViewTransition(() => {
    applyTheme(theme);
    commit();
  });

  const cleanup = () => {
    delete root.dataset.themeTransition;
    root.style.removeProperty("--theme-ripple-x");
    root.style.removeProperty("--theme-ripple-y");
    root.style.removeProperty("--theme-ripple-radius");
  };

  void transition.finished.then(cleanup, cleanup);
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
  const isFirstThemeApplyRef = useRef(true);

  useEffect(() => {
    if (isFirstThemeApplyRef.current) {
      isFirstThemeApplyRef.current = false;
      applyTheme(resolvedTheme);
      return;
    }

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

  const handleToggleTheme = (origin?: { x: number; y: number }) => {
    applyThemeWithTransition(nextTheme, origin, () => {
      setThemePreference(nextTheme);
    });
  };

  return (
    <HeartbeatSlotProvider>
      <Dashboard />
      <ThemeToggle
        currentTheme={resolvedTheme}
        nextTheme={nextTheme}
        onToggle={handleToggleTheme}
      />
    </HeartbeatSlotProvider>
  );
}

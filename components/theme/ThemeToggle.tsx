"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/store/theme";

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  // Sync the store with whatever ThemeScript already applied to the DOM pre-hydration.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") {
      setTheme(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="w-full rounded-lg border border-line bg-surf px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-t2 hover:border-acc hover:text-t1"
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

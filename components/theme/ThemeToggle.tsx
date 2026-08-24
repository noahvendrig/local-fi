"use client";

import { useSettingsStore } from "@/lib/store/settings";

export function ThemeToggle() {
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);

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

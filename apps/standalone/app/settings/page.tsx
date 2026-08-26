import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = {
  title: "Settings · local-fi",
};

// Reused wholesale — MobileDevicesSection (pairing status/"Forget") already degrades gracefully,
// and every other section here is local device/browser state (theme, playback prefs, shortcuts).
// The one rough edge: its "Library health" link points at /health, a route this build doesn't
// have (Phase 6) — a dead link until paired, not worth a special case for one settings row.
export default function StandaloneSettings() {
  return <SettingsView />;
}

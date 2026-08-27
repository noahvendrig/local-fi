import { MobileLibraryView } from "@/components/library/MobileLibraryView";

// No Home dashboard here — HomeView's weekly-listening-stats have no meaning with zero synced
// play history, which is the standalone app's default state. The Library view (defaulting to
// the "All songs" segment, which merges on-device imports with any paired PC's library — see
// MobileLibraryView.tsx) is the root screen instead.
export default function StandaloneHome() {
  return <MobileLibraryView />;
}

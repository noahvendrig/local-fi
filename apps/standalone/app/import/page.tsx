import { MobileLocalImportSection } from "@/components/ingest/MobileLocalImportSection";

// The full desktop ImportView (app/import/page.tsx in the root app) pulls in watched-folder
// syncing and the drag-and-drop ingest tray — both desktop-only, backend-dependent surfaces with
// no place in a phone-only, PC-optional app. MobileLocalImportSection is already fully
// backend-free (client-side only, per lib/offline/localImport.ts), so it's used directly.
export default function StandaloneImport() {
  return (
    <div className="px-4 pt-4">
      <h1 className="text-2xl font-bold leading-[1.2] text-t1">Import</h1>
      <MobileLocalImportSection />
    </div>
  );
}

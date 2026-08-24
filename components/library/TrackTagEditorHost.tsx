"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTrack } from "@/lib/api/tracksClient";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { TagEditorModal } from "./TagEditorModal";

// Single global host for the track-level tag editor (M9), driven by lib/store/tagEditor.ts —
// mounted once in the root layout so both the command palette's "Edit tags" action (M8) and any
// per-row edit button can open the same modal without duplicating the fetch-then-open logic.
export function TrackTagEditorHost() {
  const trackId = useTagEditorStore((s) => s.trackId);
  const close = useTagEditorStore((s) => s.close);

  const { data: track } = useQuery({
    queryKey: ["track", trackId],
    queryFn: () => fetchTrack(trackId as number),
    enabled: trackId != null,
  });

  if (trackId == null || !track) return null;

  return (
    <TagEditorModal
      title="Edit track tags"
      mode="track"
      trackIds={[track.id]}
      initialValues={{
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle,
        albumArtist: track.albumArtistName,
        trackNumber: track.trackNumber,
        discNumber: track.discNumber,
        year: track.year,
        genre: track.genre,
      }}
      onClose={close}
    />
  );
}

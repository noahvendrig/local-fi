import type { QueryClient } from "@tanstack/react-query";

/** Shared cache bust after a library mutation (remove, restore, purge, tag edit, scan). */
export function invalidateLibraryQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["tracks"] });
  queryClient.invalidateQueries({ queryKey: ["albums"] });
  queryClient.invalidateQueries({ queryKey: ["artists"] });
  queryClient.invalidateQueries({ queryKey: ["album"] });
  queryClient.invalidateQueries({ queryKey: ["artist"] });
  queryClient.invalidateQueries({ queryKey: ["playlist"] });
  queryClient.invalidateQueries({ queryKey: ["playlists"] });
  queryClient.invalidateQueries({ queryKey: ["home"] });
  queryClient.invalidateQueries({ queryKey: ["trash"] });
  queryClient.invalidateQueries({ queryKey: ["health"] });
  queryClient.invalidateQueries({ queryKey: ["track"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
}

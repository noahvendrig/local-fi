import { useEffect, useRef, type RefObject } from "react";

// Observes a sentinel element and calls `onLoadMore` once it scrolls into view within
// `rootRef`'s container (or the viewport if no rootRef is given). Used to replace "Load more"
// buttons with automatic pagination as the user scrolls near the end of a list.
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  rootRef,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  rootRef?: RefObject<HTMLElement | null>;
}): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: rootRef?.current ?? null, rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, rootRef]);

  return sentinelRef;
}

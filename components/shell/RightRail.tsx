// 360px right-rail overlay slot — position: absolute, not a flex sibling, so it
// never reflows main content (§9). Empty and closed in M0; the Queue drawer and
// full-screen Now Playing overlay mount here starting M5.
export function RightRail() {
  return (
    <aside
      aria-hidden
      className="pointer-events-none fixed inset-y-0 right-0 z-20 w-[360px] translate-x-full bg-surf opacity-0"
    />
  );
}

import { Suspense } from "react";
import { PairView } from "@/components/pairing/PairView";

export default function StandalonePair() {
  return (
    <Suspense fallback={null}>
      <PairView />
    </Suspense>
  );
}

import { Suspense } from "react";
import { PairView } from "@/components/pairing/PairView";

export default function PairPage() {
  return (
    <Suspense fallback={null}>
      <PairView />
    </Suspense>
  );
}

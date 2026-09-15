import { NextResponse } from "next/server";
import { loadFingerprintJobSnapshot } from "@/lib/fingerprint/events";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = loadFingerprintJobSnapshot(Number(id));

  if (!snapshot) {
    return NextResponse.json({ error: { code: "not_found", message: "Fingerprint job not found." } }, { status: 404 });
  }

  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}

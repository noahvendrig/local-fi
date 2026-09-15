import { NextResponse } from "next/server";
import { loadMixtapeJobSnapshot } from "@/lib/mixtapes/events";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = loadMixtapeJobSnapshot(Number(id));

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Mixtape job not found." } }, { status: 404 });
  }

  return NextResponse.json(job);
}

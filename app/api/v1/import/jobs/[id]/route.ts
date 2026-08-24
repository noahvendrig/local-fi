import { NextResponse } from "next/server";
import { loadJobSnapshot } from "@/lib/import/events";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = loadJobSnapshot(Number(id));

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Import job not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({ ...snapshot.job, files: snapshot.files });
}

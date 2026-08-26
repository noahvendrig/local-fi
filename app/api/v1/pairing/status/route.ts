import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { devices, pairingSessions } from "@/lib/db/schema";

/** GET /api/v1/pairing/status?code=X — the PC's Devices modal polls this while a code is shown. */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Missing code." } }, { status: 400 });
  }

  const db = getDb();
  const session = db.select().from(pairingSessions).where(eq(pairingSessions.code, code)).get();
  if (!session) {
    return NextResponse.json({ status: "not_found" as const, device: null });
  }

  if (session.consumedAt && session.deviceId) {
    const device = db.select().from(devices).where(eq(devices.id, session.deviceId)).get();
    return NextResponse.json({
      status: "completed" as const,
      device: device ? { id: device.id, name: device.name, pairedAt: device.pairedAt } : null,
    });
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ status: "expired" as const, device: null });
  }

  return NextResponse.json({ status: "pending" as const, device: null });
}

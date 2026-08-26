import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/** DELETE /api/v1/pairing/devices/:id — "Unpair" in the Devices modal. Soft: sets revokedAt so
 *  verifyToken.ts's device-token check starts rejecting it immediately, row kept for history. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid device id." } }, { status: 400 });
  }

  getDb().update(devices).set({ revokedAt: new Date().toISOString() }).where(eq(devices.id, deviceId)).run();

  return new NextResponse(null, { status: 204 });
}

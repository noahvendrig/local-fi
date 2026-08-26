import { desc, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/** GET /api/v1/pairing/devices — the "Paired devices" list in the Devices modal. */
export async function GET() {
  const rows = getDb()
    .select({
      id: devices.id,
      name: devices.name,
      pairedAt: devices.pairedAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(isNull(devices.revokedAt))
    .orderBy(desc(devices.pairedAt))
    .all();

  return NextResponse.json({ items: rows });
}

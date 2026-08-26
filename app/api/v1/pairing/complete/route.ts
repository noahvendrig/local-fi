import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { devices, pairingSessions } from "@/lib/db/schema";
import { normalizePairingCode } from "@/lib/pairing/code";
import { generateDeviceToken } from "@/lib/pairing/qr";

const BodySchema = z.object({
  code: z.string().min(1),
  deviceName: z.string().trim().min(1).max(80).optional(),
});

/**
 * POST /api/v1/pairing/complete — the phone calls this right after scanning/typing a code.
 * Deliberately excluded from proxy.ts's auth check (see proxy.ts): the whole point is that the
 * phone doesn't have a token yet, so this is the one endpoint that has to be reachable without one.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid pairing request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const code = normalizePairingCode(parsed.data.code);
  const db = getDb();
  const session = db.select().from(pairingSessions).where(eq(pairingSessions.code, code)).get();

  if (!session) {
    return NextResponse.json({ error: { code: "invalid_code", message: "That code isn't recognized." } }, { status: 404 });
  }
  if (session.consumedAt) {
    return NextResponse.json({ error: { code: "code_used", message: "That code has already been used." } }, { status: 409 });
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: { code: "code_expired", message: "That code has expired — generate a new one." } }, { status: 410 });
  }

  const now = new Date().toISOString();
  const device = db
    .insert(devices)
    .values({
      uuid: randomUUID(),
      token: generateDeviceToken(),
      name: parsed.data.deviceName?.trim() || "Paired device",
      pairedAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get();

  db.update(pairingSessions).set({ consumedAt: now, deviceId: device.id }).where(eq(pairingSessions.id, session.id)).run();

  return NextResponse.json({ deviceId: device.id, deviceToken: device.token, deviceName: device.name });
}

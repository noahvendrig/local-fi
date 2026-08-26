import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { pairingSessions } from "@/lib/db/schema";
import { generatePairingCode } from "@/lib/pairing/code";
import { buildLanOrigin, generatePairingQrDataUrl } from "@/lib/pairing/qr";

const CODE_TTL_MS = 2 * 60 * 1000;

/** POST /api/v1/pairing/start — PC generates a fresh code + QR for the Devices modal. */
export async function POST(request: Request) {
  const lanOrigin = buildLanOrigin(request);
  if (!lanOrigin) {
    return NextResponse.json(
      { error: { code: "no_lan_address", message: "Couldn't detect a LAN address on this machine." } },
      { status: 500 }
    );
  }

  const code = generatePairingCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  getDb().insert(pairingSessions).values({ code, expiresAt, createdAt: now.toISOString() }).run();

  const pairingUrl = `${lanOrigin}/pair?code=${encodeURIComponent(code)}`;
  const qrDataUrl = await generatePairingQrDataUrl(pairingUrl);

  return NextResponse.json({ code, expiresAt, lanUrl: lanOrigin, pairingUrl, qrDataUrl });
}

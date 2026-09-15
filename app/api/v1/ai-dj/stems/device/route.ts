import { NextResponse } from "next/server";
import { getStemsDeviceInfo } from "@/lib/pythonBackend/stemsClient";

/** GET /api/v1/ai-dj/stems/device — GPU/CPU status for the AI DJ view's device indicator. */
export async function GET() {
  return NextResponse.json(await getStemsDeviceInfo());
}

import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const items = getDb().select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(limit).all();
  return NextResponse.json({ items });
}

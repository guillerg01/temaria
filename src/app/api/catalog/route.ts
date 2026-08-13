import { NextResponse } from "next/server";

import { getCatalog } from "@/lib/corpus";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getCatalog(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

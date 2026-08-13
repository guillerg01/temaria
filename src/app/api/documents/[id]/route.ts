import { NextResponse } from "next/server";

import { getDocument } from "@/lib/corpus";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const document = getDocument(decodeURIComponent(id));

  if (!document) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  return NextResponse.json(document, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

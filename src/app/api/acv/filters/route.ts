import { NextResponse } from "next/server";
import { getAcvFilterOptions } from "@/lib/ats-api";

export async function GET() {
  try {
    const options = await getAcvFilterOptions();
    return NextResponse.json(options);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load ACV filter options";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

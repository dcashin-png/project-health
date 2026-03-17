import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import type { StripeTaxSnapshot } from "@/lib/stripe-tax-types";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "stripe-tax-snapshots");

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");

  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

    if (date) {
      // Return a specific snapshot
      const filePath = path.join(SNAPSHOT_DIR, `${date}.json`);
      const raw = await fs.readFile(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as StripeTaxSnapshot);
    }

    // Return list of all available snapshot dates
    const files = await fs.readdir(SNAPSHOT_DIR);
    const dates = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort()
      .reverse();

    return NextResponse.json({ dates });
  } catch (error) {
    if (date) {
      return NextResponse.json(
        { error: `No snapshot found for ${date}` },
        { status: 404 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

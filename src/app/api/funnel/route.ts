import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_FILE = path.join(process.cwd(), "data", "funnel-data.json");

export async function GET() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return NextResponse.json(
        { error: "No funnel data found. Run: node scripts/fetch-funnel.mjs" },
        { status: 404 },
      );
    }

    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read funnel data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

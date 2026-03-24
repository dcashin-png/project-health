import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "roadmap-snapshots");

export interface RoadmapSnapshot {
  date: string;
  month: string; // "current" or "next"
  monthLabel: string;
  experiments: Array<{
    key: string;
    summary: string;
    estimatedAcv: number | null;
    experimentStartDate: string | null;
    experimentEndDate: string | null;
  }>;
}

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") || "current";
  const selectedDate = request.nextUrl.searchParams.get("date"); // optional: fetch a specific snapshot
  const today = new Date().toISOString().split("T")[0];

  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

    const files = await fs.readdir(SNAPSHOT_DIR);
    const matching = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: f, date: f.replace(".json", "").split("_")[0] }))
      .filter((f) => {
        try {
          const raw = f.file.replace(".json", "");
          const parts = raw.split("_");
          return parts[1] === month;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // Return list of available snapshot dates (excluding today)
    const availableDates = matching
      .filter((f) => f.date !== today)
      .map((f) => f.date);

    // If a specific date is requested, return that snapshot
    const target = selectedDate
      ? matching.find((f) => f.date === selectedDate)
      : matching.find((f) => f.date !== today); // default: most recent before today

    if (!target) {
      return NextResponse.json({ snapshot: null, availableDates });
    }

    const filePath = path.join(SNAPSHOT_DIR, target.file);
    const raw = await fs.readFile(filePath, "utf-8");
    return NextResponse.json({
      snapshot: JSON.parse(raw) as RoadmapSnapshot,
      availableDates,
    });
  } catch {
    return NextResponse.json({ snapshot: null, availableDates: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

    const body = (await request.json()) as RoadmapSnapshot;
    const fileName = `${body.date}_${body.month}.json`;
    const filePath = path.join(SNAPSHOT_DIR, fileName);

    await fs.writeFile(filePath, JSON.stringify(body, null, 2));

    return NextResponse.json({ saved: true, file: fileName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save snapshot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

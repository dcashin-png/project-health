import { NextResponse } from "next/server";
import { listProjects } from "@/lib/jira-api";

export async function GET() {
  try {
    const raw = await listProjects();
    const projects = raw.map((p) => ({
      key: p.key,
      name: p.name,
      lead: p.lead?.displayName || p.lead?.name,
    }));
    return NextResponse.json({ projects });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

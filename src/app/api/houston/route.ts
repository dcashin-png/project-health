import { NextRequest, NextResponse } from "next/server";
import { callHoustonMcp, isHoustonConnected } from "@/lib/houston-api";

export async function GET(request: NextRequest) {
  try {
    const connected = await isHoustonConnected();
    if (!connected) {
      return NextResponse.json(
        { error: "Houston not connected. Run: node scripts/houston-auth.mjs" },
        { status: 503 }
      );
    }

    const tool = request.nextUrl.searchParams.get("tool");
    const argsJson = request.nextUrl.searchParams.get("args") || "{}";

    if (!tool) {
      return NextResponse.json({ error: "Missing 'tool' parameter" }, { status: 400 });
    }

    const ALLOWED_TOOLS = [
      "search_experiments",
      "get_experiments_by_status",
      "get_experiments_by_date_range",
      "get_experiments_by_tags",
      "get_recent_rollouts",
      "get_active_rollouts",
      "get_experiment_details",
      "get_experiment_health",
      "get_experiment_exposures",
      "get_experiment_results",
      "get_experiment_metrics",
      "get_experiment_metric_metadata",
      "get_guardrail_metrics",
      "get_experiment_history",
      "get_experiments_summary",
      "find_experiments_by_user",
      "compare_experiments",
    ];

    if (!ALLOWED_TOOLS.includes(tool)) {
      return NextResponse.json({ error: `Tool not allowed: ${tool}` }, { status: 400 });
    }

    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const text = await callHoustonMcp(tool, args);

    // Try to parse as JSON, otherwise return as text
    try {
      const data = JSON.parse(text);
      return NextResponse.json({ data });
    } catch {
      return NextResponse.json({ text });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Houston request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

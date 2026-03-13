import { NextRequest, NextResponse } from "next/server";
import { parseCsv, suggestMapping, MAPPABLE_FIELDS } from "@/lib/sheets";

// Accept CSV content directly (user pastes or uploads)
export async function POST(request: NextRequest) {
  try {
    const { csv } = await request.json();
    if (!csv || typeof csv !== "string") {
      return NextResponse.json({ error: "csv content is required" }, { status: 400 });
    }

    const { headers, rows } = parseCsv(csv);

    // Auto-suggest mappings
    const suggestedMapping: Record<number, string | null> = {};
    for (let i = 0; i < headers.length; i++) {
      suggestedMapping[i] = suggestMapping(headers[i]);
    }

    // Detect which column might be a Jira key column
    let jiraKeyColumn: number | null = null;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase().trim();
      if (h === "jira key" || h === "jira id" || h === "key" || h === "jira ticket" || h === "ticket") {
        jiraKeyColumn = i;
        break;
      }
    }

    // Send first 5 rows as preview
    const preview = rows.slice(0, 5);

    return NextResponse.json({
      headers,
      preview,
      rowCount: rows.length,
      suggestedMapping,
      jiraKeyColumn,
      mappableFields: MAPPABLE_FIELDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse CSV";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { parseCsv, MAPPABLE_FIELDS, formatFieldValue } from "@/lib/sheets";
import { searchAllIssues } from "@/lib/jira-api";

interface ColumnMapping {
  [columnIndex: string]: string; // column index → jira field ID
}

interface DiffRow {
  rowIndex: number;
  jiraKey: string | null;
  summary: string;
  action: "create" | "update" | "unchanged";
  changes: Array<{ field: string; fieldLabel: string; oldValue: string; newValue: string }>;
  fields: Record<string, unknown>; // formatted Jira field values
}

export async function POST(request: NextRequest) {
  try {
    const {
      csv,
      mapping,
      jiraKeyColumn,
      projectKey,
      issueType,
    }: {
      csv: string;
      mapping: ColumnMapping;
      jiraKeyColumn: number | null;
      projectKey: string;
      issueType: string;
    } = await request.json();

    if (!csv || !mapping || !projectKey) {
      return NextResponse.json({ error: "csv, mapping, and projectKey are required" }, { status: 400 });
    }

    // Parse CSV data
    const { headers, rows } = parseCsv(csv);

    // Build field map for quick lookup
    const fieldMap = new Map(MAPPABLE_FIELDS.map((f) => [f.id, f]));

    // Parse rows into structured data
    const sheetRows: Array<{
      rowIndex: number;
      jiraKey: string | null;
      fields: Record<string, unknown>;
      rawValues: Record<string, string>;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const jiraKey =
        jiraKeyColumn !== null && row[jiraKeyColumn]
          ? row[jiraKeyColumn].trim()
          : null;

      const fields: Record<string, unknown> = {};
      const rawValues: Record<string, string> = {};

      for (const [colIdx, fieldId] of Object.entries(mapping)) {
        const col = parseInt(colIdx, 10);
        const value = row[col] || "";
        const field = fieldMap.get(fieldId);
        if (!field || !value.trim()) continue;

        rawValues[fieldId] = value.trim();
        fields[fieldId] = formatFieldValue(value, fieldId, field.type);
      }

      // Skip rows with no summary
      if (!fields.summary && !jiraKey) continue;

      sheetRows.push({ rowIndex: i, jiraKey, fields, rawValues });
    }

    // Fetch existing Jira issues for rows that have keys
    const existingKeys = sheetRows
      .map((r) => r.jiraKey)
      .filter((k): k is string => !!k && /^[A-Z]+-\d+$/.test(k));

    let jiraIssues: Map<string, Record<string, unknown>> = new Map();

    if (existingKeys.length > 0) {
      // Batch fetch in groups of 50
      for (let i = 0; i < existingKeys.length; i += 50) {
        const batch = existingKeys.slice(i, i + 50);
        const jql = `key in (${batch.join(",")})`;
        const jiraFields = [...new Set(Object.values(mapping))];
        const issues = await searchAllIssues(jql, jiraFields);

        for (const issue of issues) {
          const f = issue.fields as Record<string, unknown>;
          const flat: Record<string, unknown> = {
            summary: issue.fields.summary,
            description: (f.description as string) || "",
            priority: (f.priority as { name?: string })?.name || "",
            labels: (issue.fields.labels || []).join(", "),
          };

          // Extract custom fields
          for (const fieldId of Object.values(mapping)) {
            if (flat[fieldId] !== undefined) continue;
            const val = f[fieldId];
            if (val === null || val === undefined) {
              flat[fieldId] = "";
            } else if (typeof val === "object" && "value" in (val as Record<string, unknown>)) {
              flat[fieldId] = (val as { value: string }).value;
            } else if (typeof val === "object" && "name" in (val as Record<string, unknown>)) {
              flat[fieldId] = (val as { name: string }).name;
            } else if (Array.isArray(val)) {
              flat[fieldId] = val
                .map((v) => (typeof v === "object" && v !== null ? (v as { name?: string; value?: string }).name || (v as { value?: string }).value || "" : String(v)))
                .join(", ");
            } else {
              flat[fieldId] = String(val);
            }
          }

          jiraIssues.set(issue.key, flat);
        }
      }
    }

    // Compute diff
    const diff: DiffRow[] = [];

    for (const sheetRow of sheetRows) {
      const { rowIndex, jiraKey, fields, rawValues } = sheetRow;
      const summaryValue = (fields.summary as string) || `Row ${rowIndex + 2}`;

      if (!jiraKey) {
        // New row — will create
        diff.push({
          rowIndex,
          jiraKey: null,
          summary: summaryValue,
          action: "create",
          changes: [],
          fields,
        });
        continue;
      }

      const jiraData = jiraIssues.get(jiraKey);
      if (!jiraData) {
        // Key doesn't exist in Jira — treat as create
        diff.push({
          rowIndex,
          jiraKey,
          summary: summaryValue,
          action: "create",
          changes: [],
          fields,
        });
        continue;
      }

      // Compare fields
      const changes: DiffRow["changes"] = [];
      for (const [fieldId, sheetValue] of Object.entries(rawValues)) {
        const jiraValue = String(jiraData[fieldId] || "").trim();
        const sheetStr = String(sheetValue).trim();

        // Normalize date comparison
        const fieldDef = fieldMap.get(fieldId);
        let jiraNorm = jiraValue;
        let sheetNorm = sheetStr;
        if (fieldDef?.type === "date") {
          try {
            const jd = new Date(jiraValue);
            const sd = new Date(sheetStr);
            if (!isNaN(jd.getTime())) jiraNorm = jd.toISOString().split("T")[0];
            if (!isNaN(sd.getTime())) sheetNorm = sd.toISOString().split("T")[0];
          } catch { /* use raw */ }
        }

        if (jiraNorm !== sheetNorm && sheetNorm) {
          changes.push({
            field: fieldId,
            fieldLabel: fieldDef?.label || fieldId,
            oldValue: jiraValue,
            newValue: sheetStr,
          });
        }
      }

      diff.push({
        rowIndex,
        jiraKey,
        summary: summaryValue,
        action: changes.length > 0 ? "update" : "unchanged",
        changes,
        fields,
      });
    }

    const creates = diff.filter((d) => d.action === "create").length;
    const updates = diff.filter((d) => d.action === "update").length;
    const unchanged = diff.filter((d) => d.action === "unchanged").length;

    return NextResponse.json({
      diff,
      summary: { creates, updates, unchanged, total: diff.length },
      headers,
      projectKey,
      issueType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diff failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

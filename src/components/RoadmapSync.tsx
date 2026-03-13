"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface MappableField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
}

interface DiffRow {
  rowIndex: number;
  jiraKey: string | null;
  summary: string;
  action: "create" | "update" | "unchanged";
  changes: Array<{ field: string; fieldLabel: string; oldValue: string; newValue: string }>;
  fields: Record<string, unknown>;
}

interface SyncResult {
  rowIndex: number;
  jiraKey: string;
  action: "created" | "updated";
  summary: string;
  error?: string;
}

interface RoadmapConfig {
  mapping: Record<number, string>;
  jiraKeyColumn: number | null;
  projectKey: string;
  issueType: string;
}

const CONFIG_STORAGE_KEY = "roadmap-config";

function loadConfig(): RoadmapConfig | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveConfigToStorage(config: RoadmapConfig) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

type Step = "upload" | "mapping" | "diff" | "syncing" | "results";

export function RoadmapSync() {
  const [step, setStep] = useState<Step>("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV data (stored in memory for the session)
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Sheet data from parsing
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mappableFields, setMappableFields] = useState<MappableField[]>([]);

  // Mapping step
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [jiraKeyColumn, setJiraKeyColumn] = useState<number | null>(null);
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Epic");

  // Diff step
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]);
  const [diffSummary, setDiffSummary] = useState<{ creates: number; updates: number; unchanged: number; total: number } | null>(null);
  const [selectedForSync, setSelectedForSync] = useState<Set<number>>(new Set());
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Sync results
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Load saved config
  useEffect(() => {
    const config = loadConfig();
    if (config) {
      setMapping(config.mapping);
      setJiraKeyColumn(config.jiraKeyColumn);
      setProjectKey(config.projectKey);
      setIssueType(config.issueType);
    }
  }, []);

  const parseCsvContent = useCallback(async (csv: string) => {
    setLoadingCsv(true);
    setUploadError(null);

    try {
      const res = await fetch("/api/roadmap/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (data.error) {
        setUploadError(data.error);
        return;
      }

      setCsvContent(csv);
      setHeaders(data.headers);
      setPreview(data.preview);
      setRowCount(data.rowCount);
      setMappableFields(data.mappableFields);

      // Apply suggested mapping (only for unmapped columns)
      const suggested = data.suggestedMapping as Record<number, string | null>;
      setMapping((prev) => {
        const merged = { ...prev };
        for (const [col, fieldId] of Object.entries(suggested)) {
          if (fieldId && !merged[Number(col)]) {
            merged[Number(col)] = fieldId;
          }
        }
        return merged;
      });

      if (data.jiraKeyColumn !== null && jiraKeyColumn === null) {
        setJiraKeyColumn(data.jiraKeyColumn);
      }

      setStep("mapping");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to parse CSV");
    } finally {
      setLoadingCsv(false);
    }
  }, [jiraKeyColumn]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) parseCsvContent(text);
    };
    reader.onerror = () => setUploadError("Failed to read file");
    reader.readAsText(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.trim()) {
      // Convert tab-separated (from Google Sheets copy) to CSV
      const lines = text.split("\n");
      const hasTabs = lines.some((l) => l.includes("\t"));
      if (hasTabs) {
        const csv = lines
          .map((line) =>
            line
              .split("\t")
              .map((cell) => {
                // Quote cells that contain commas or quotes
                if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
                  return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
              })
              .join(",")
          )
          .join("\n");
        parseCsvContent(csv);
      } else {
        parseCsvContent(text);
      }
    }
  };

  const handleMappingChange = (colIndex: number, fieldId: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (fieldId === "") {
        delete next[colIndex];
      } else {
        next[colIndex] = fieldId;
      }
      return next;
    });
  };

  const saveAndDiff = async () => {
    if (!projectKey) {
      setDiffError("Please enter a Jira project key");
      return;
    }
    if (!csvContent) {
      setDiffError("No sheet data loaded");
      return;
    }

    saveConfigToStorage({ mapping, jiraKeyColumn, projectKey, issueType });

    setDiffLoading(true);
    setDiffError(null);

    try {
      const res = await fetch("/api/roadmap/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvContent, mapping, jiraKeyColumn, projectKey, issueType }),
      });
      const data = await res.json();
      if (data.error) {
        setDiffError(data.error);
        return;
      }

      setDiffRows(data.diff);
      setDiffSummary(data.summary);

      const actionable = (data.diff as DiffRow[])
        .filter((r) => r.action !== "unchanged")
        .map((r) => r.rowIndex);
      setSelectedForSync(new Set(actionable));

      setStep("diff");
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setDiffLoading(false);
    }
  };

  const executeSync = async () => {
    const rowsToSync = diffRows
      .filter((r) => selectedForSync.has(r.rowIndex) && r.action !== "unchanged")
      .map((r) => ({
        rowIndex: r.rowIndex,
        jiraKey: r.jiraKey,
        action: r.action,
        fields: r.fields,
        summary: r.summary,
      }));

    if (rowsToSync.length === 0) return;

    setSyncLoading(true);
    setSyncError(null);
    setStep("syncing");

    try {
      const res = await fetch("/api/roadmap/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToSync, projectKey, issueType }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
        setStep("diff");
        return;
      }

      setSyncResults(data.results);
      setStep("results");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
      setStep("diff");
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleSyncRow = (rowIndex: number) => {
    setSelectedForSync((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const reset = () => {
    setStep("upload");
    setCsvContent(null);
    setHeaders([]);
    setPreview([]);
    setDiffRows([]);
    setDiffSummary(null);
    setSyncResults([]);
    setSyncError(null);
    setDiffError(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "mapping", "diff", "results"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-300">/</span>}
            <span className={step === s ? "font-medium text-gray-900" : "text-gray-400"}>
              {s === "upload" ? "Load Data" : s === "mapping" ? "Column Mapping" : s === "diff" ? "Review Changes" : "Results"}
            </span>
          </span>
        ))}
      </div>

      {/* Step 1: Upload / Paste */}
      {step === "upload" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">Load your roadmap data</h3>
            <p className="text-xs text-gray-500 mb-4">
              Open your Google Sheet, select all data (Cmd+A), copy (Cmd+C), and paste below.
              Or download as CSV (File &rarr; Download &rarr; CSV) and upload the file.
            </p>
          </div>

          {/* Paste area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paste from Google Sheets</label>
            <textarea
              onPaste={handlePaste}
              placeholder="Click here and paste your spreadsheet data (Cmd+V)..."
              rows={6}
              className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 placeholder:text-gray-400"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upload CSV file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {loadingCsv && (
            <p className="text-sm text-gray-500">Parsing data...</p>
          )}

          {uploadError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === "mapping" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Column Mapping</h3>
              <p className="text-xs text-gray-500">{rowCount} rows &middot; Map sheet columns to Jira fields</p>
            </div>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
              Load different data
            </button>
          </div>

          {/* Project + Issue Type */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Jira Project Key</label>
              <input
                type="text"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                placeholder="e.g. NEWXP"
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Issue Type</label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Epic">Epic</option>
                <option value="Experiment">Experiment</option>
                <option value="Story">Story</option>
                <option value="Task">Task</option>
              </select>
            </div>
          </div>

          {/* Jira Key Column */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Jira Key Column <span className="text-gray-400 font-normal">(which column has existing Jira keys, if any?)</span>
            </label>
            <select
              value={jiraKeyColumn ?? "none"}
              onChange={(e) => setJiraKeyColumn(e.target.value === "none" ? null : parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">No Jira key column yet (all rows are new)</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>Column: {h || `(column ${i + 1})`}</option>
              ))}
            </select>
          </div>

          {/* Mapping table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Sheet Column</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Preview</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Jira Field</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {headers.map((header, i) => (
                  <tr key={i} className={i === jiraKeyColumn ? "bg-yellow-50" : ""}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {header || <span className="text-gray-400">(empty)</span>}
                      {i === jiraKeyColumn && (
                        <span className="ml-2 text-xs text-yellow-600 font-normal">Jira Key</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs truncate max-w-[200px]">
                      {preview.slice(0, 3).map((row) => row[i]).filter(Boolean).join(" / ") || "\u2014"}
                    </td>
                    <td className="px-3 py-2">
                      {i === jiraKeyColumn ? (
                        <span className="text-xs text-yellow-600">Used as Jira key identifier</span>
                      ) : (
                        <select
                          value={mapping[i] || ""}
                          onChange={(e) => handleMappingChange(i, e.target.value)}
                          className={`w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            mapping[i] ? "border-blue-300 bg-blue-50" : "border-gray-200"
                          }`}
                        >
                          <option value="">&mdash; skip &mdash;</option>
                          {mappableFields.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}{f.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diffError && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {diffError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
              Back
            </button>
            <button
              onClick={saveAndDiff}
              disabled={!projectKey || Object.keys(mapping).length === 0 || diffLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {diffLoading ? "Computing diff..." : "Check for Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review Diff */}
      {step === "diff" && diffSummary && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Review Changes</h3>
              <p className="text-xs text-gray-500">
                {diffSummary.creates} to create &middot; {diffSummary.updates} to update &middot; {diffSummary.unchanged} unchanged
              </p>
            </div>
            <button onClick={() => setStep("mapping")} className="text-sm text-gray-500 hover:text-gray-700">
              Edit mapping
            </button>
          </div>

          {syncError && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {syncError}
            </div>
          )}

          {diffRows.filter((r) => r.action !== "unchanged").length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">Everything is in sync</p>
              <p className="text-sm">No differences found between the sheet and Jira.</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {diffRows
                  .filter((r) => r.action !== "unchanged")
                  .map((row) => (
                    <label
                      key={row.rowIndex}
                      className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedForSync.has(row.rowIndex) ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedForSync.has(row.rowIndex)}
                        onChange={() => toggleSyncRow(row.rowIndex)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.action === "create"
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {row.action}
                          </span>
                          {row.jiraKey && (
                            <a
                              href={`https://jira.tinyspeck.com/browse/${row.jiraKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.jiraKey}
                            </a>
                          )}
                          <span className="text-sm text-gray-900 truncate">{row.summary}</span>
                        </div>

                        {row.action === "create" && (
                          <p className="text-xs text-gray-500 mt-1">
                            New {issueType} will be created in {projectKey}
                          </p>
                        )}

                        {row.changes.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {row.changes.map((c, i) => (
                              <p key={i} className="text-xs text-gray-500">
                                <span className="font-medium">{c.fieldLabel}:</span>{" "}
                                <span className="text-red-500 line-through">{c.oldValue || "(empty)"}</span>
                                {" \u2192 "}
                                <span className="text-green-600">{c.newValue}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
              </div>

              {diffSummary.unchanged > 0 && (
                <p className="text-xs text-gray-400 text-center">
                  {diffSummary.unchanged} row{diffSummary.unchanged !== 1 ? "s" : ""} unchanged (not shown)
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setStep("mapping")} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                  Back
                </button>
                <button
                  onClick={executeSync}
                  disabled={selectedForSync.size === 0 || syncLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sync {selectedForSync.size} to Jira
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Syncing */}
      {step === "syncing" && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Syncing to Jira...</p>
          <p className="text-sm">Creating and updating issues. This may take a moment.</p>
        </div>
      )}

      {/* Step 4: Results */}
      {step === "results" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Sync Complete</h3>
            <p className="text-xs text-gray-500">
              {syncResults.filter((r) => !r.error).length} succeeded &middot; {syncResults.filter((r) => r.error).length} failed
            </p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {syncResults.map((r) => (
              <div key={r.rowIndex} className="flex items-center gap-3 px-4 py-2">
                {r.error ? (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                    failed
                  </span>
                ) : (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.action === "created" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {r.action}
                  </span>
                )}
                {r.jiraKey && (
                  <a
                    href={`https://jira.tinyspeck.com/browse/${r.jiraKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline font-mono"
                  >
                    {r.jiraKey}
                  </a>
                )}
                <span className="text-sm text-gray-900 truncate">{r.summary}</span>
                {r.error && <span className="text-xs text-red-600 ml-auto shrink-0">{r.error}</span>}
              </div>
            ))}
          </div>

          <div className="rounded bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            <p className="font-medium mb-1">Copy Jira keys back to your sheet</p>
            <p className="text-xs">Add the Jira keys above to your spreadsheet so future syncs can detect updates vs new rows.</p>
            <button
              onClick={() => {
                const keys = syncResults
                  .filter((r) => r.action === "created" && !r.error)
                  .map((r) => `Row ${r.rowIndex + 2}: ${r.jiraKey}`)
                  .join("\n");
                navigator.clipboard.writeText(keys);
              }}
              className="mt-2 px-3 py-1 text-xs font-medium bg-blue-100 rounded hover:bg-blue-200 transition-colors"
            >
              Copy new keys to clipboard
            </button>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
              Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

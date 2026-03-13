"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AcvFilterOptions, AcvRow, AcvDataResult } from "@/lib/types";

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

type GroupByKey = "attribution" | "segment" | "businessLine" | "productLine" | "region" | "quarter";

const GROUP_BY_OPTIONS: { key: GroupByKey; label: string }[] = [
  { key: "attribution", label: "Attribution" },
  { key: "segment", label: "Segment" },
  { key: "businessLine", label: "Business Line" },
  { key: "productLine", label: "Product Line" },
  { key: "region", label: "Region" },
  { key: "quarter", label: "Quarter" },
];

function groupRows(rows: AcvRow[], groupBy: GroupByKey): { label: string; acv: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row[groupBy] || "(blank)";
    map.set(key, (map.get(key) || 0) + row.acv);
  }
  return [...map.entries()]
    .map(([label, acv]) => ({ label, acv }))
    .sort((a, b) => b.acv - a.acv);
}

function timeSeriesFromRows(rows: AcvRow[]): { date: string; acv: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const d = row.snapshotDate;
    map.set(d, (map.get(d) || 0) + row.acv);
  }
  return [...map.entries()]
    .map(([date, acv]) => ({ date, acv }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
}

function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter((v) => v !== val));
    else onChange([...selected, val]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 transition-colors ${
          selected.length > 0
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-200 text-gray-600"
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="ml-1 bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5">
            {selected.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-60 overflow-y-auto">
          <button
            onClick={() => onChange([])}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-b"
          >
            Clear all
          </button>
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700 truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function AcvDashboard() {
  const [filterOptions, setFilterOptions] = useState<AcvFilterOptions | null>(null);
  const [data, setData] = useState<AcvDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByKey>("attribution");

  // Filter state
  const [attributions, setAttributions] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [businessLines, setBusinessLines] = useState<string[]>([]);
  const [productLines, setProductLines] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [quarters, setQuarters] = useState<string[]>([]);
  const [snapshotStart, setSnapshotStart] = useState("");
  const [snapshotEnd, setSnapshotEnd] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load filter options on mount
  useEffect(() => {
    fetch("/api/acv/filters")
      .then((r) => r.json())
      .then((opts) => {
        if (opts.error) {
          setError(opts.error);
          return;
        }
        setFilterOptions(opts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch data when filters change
  const fetchData = useCallback(() => {
    setDataLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (attributions.length) params.set("attributions", attributions.join(","));
    if (segments.length) params.set("segments", segments.join(","));
    if (businessLines.length) params.set("businessLines", businessLines.join(","));
    if (productLines.length) params.set("productLines", productLines.join(","));
    if (regions.length) params.set("regions", regions.join(","));
    if (quarters.length) params.set("quarters", quarters.join(","));
    if (snapshotStart) params.set("snapshotDateStart", snapshotStart);
    if (snapshotEnd) params.set("snapshotDateEnd", snapshotEnd);

    fetch(`/api/acv/data?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDataLoading(false));
  }, [attributions, segments, businessLines, productLines, regions, quarters, snapshotStart, snapshotEnd]);

  // Debounced fetch on filter change
  useEffect(() => {
    if (!filterOptions) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchData, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchData, filterOptions]);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading ACV data...</div>;
  }

  if (error && !data) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading ACV data</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!filterOptions) return null;

  const grouped = data ? groupRows(data.rows, groupBy) : [];
  const timeSeries = data ? timeSeriesFromRows(data.rows) : [];
  const maxAcv = timeSeries.length > 0 ? Math.max(...timeSeries.map((t) => t.acv)) : 0;

  // Breakdown by attribution for summary cards
  const byAttribution = data ? groupRows(data.rows, "attribution") : [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700 mr-2">Filters:</span>
          <MultiSelect label="Attribution" options={filterOptions.attributions} selected={attributions} onChange={setAttributions} />
          <MultiSelect label="Segment" options={filterOptions.segments} selected={segments} onChange={setSegments} />
          <MultiSelect label="Business Line" options={filterOptions.businessLines} selected={businessLines} onChange={setBusinessLines} />
          <MultiSelect label="Product Line" options={filterOptions.productLines} selected={productLines} onChange={setProductLines} />
          <MultiSelect label="Region" options={filterOptions.regions} selected={regions} onChange={setRegions} />
          <MultiSelect label="Quarter" options={filterOptions.quarters} selected={quarters} onChange={setQuarters} />
          <div className="flex items-center gap-1 ml-2">
            <label className="text-xs text-gray-500">Snapshot:</label>
            <input
              type="date"
              value={snapshotStart}
              onChange={(e) => setSnapshotStart(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-sm"
            />
            <span className="text-gray-400">-</span>
            <input
              type="date"
              value={snapshotEnd}
              onChange={(e) => setSnapshotEnd(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-sm"
            />
          </div>
          {(attributions.length > 0 || segments.length > 0 || businessLines.length > 0 ||
            productLines.length > 0 || regions.length > 0 || quarters.length > 0 ||
            snapshotStart || snapshotEnd) && (
            <button
              onClick={() => {
                setAttributions([]); setSegments([]); setBusinessLines([]);
                setProductLines([]); setRegions([]); setQuarters([]);
                setSnapshotStart(""); setSnapshotEnd("");
              }}
              className="text-xs text-red-600 hover:text-red-800 ml-2"
            >
              Clear all
            </button>
          )}
        </div>
        {dataLoading && <p className="text-xs text-gray-400 mt-2">Refreshing...</p>}
      </div>

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total ACV</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.totalAcv)}</p>
              <p className="text-xs text-gray-400 mt-1">as of {data.latestDs}</p>
            </div>
            {byAttribution.slice(0, 3).map((item) => (
              <div key={item.label} className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(item.acv)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {data.totalAcv > 0 ? `${((item.acv / data.totalAcv) * 100).toFixed(1)}%` : "—"} of total
                </p>
              </div>
            ))}
          </div>

          {/* Time series chart (simple bar chart) */}
          {timeSeries.length > 1 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">ACV Over Time (by Snapshot)</h3>
              <div className="flex items-end gap-1 h-40">
                {timeSeries.map((point) => (
                  <div key={point.date} className="flex-1 flex flex-col items-center group relative">
                    <div
                      className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors min-h-[2px]"
                      style={{ height: `${maxAcv > 0 ? (point.acv / maxAcv) * 100 : 0}%` }}
                    />
                    <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                      {point.date}: {formatCurrency(point.acv)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-400">
                <span>{timeSeries[0]?.date}</span>
                <span>{timeSeries[timeSeries.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Breakdown table */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700">Breakdown</h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Group by:</label>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupByKey)}
                  className="text-sm border border-gray-200 rounded px-2 py-1"
                >
                  {GROUP_BY_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">{GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label}</th>
                  <th className="text-right px-4 py-2 font-medium">ACV</th>
                  <th className="text-right px-4 py-2 font-medium">% of Total</th>
                  <th className="px-4 py-2 font-medium w-1/3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {grouped.map((item) => (
                  <tr key={item.label} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900">{item.label}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 text-right font-mono">{formatCurrency(item.acv)}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 text-right">
                      {data.totalAcv > 0 ? `${((item.acv / data.totalAcv) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${data.totalAcv > 0 ? (item.acv / data.totalAcv) * 100 : 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {grouped.length === 0 && (
              <p className="text-center py-8 text-sm text-gray-400">No data matches the current filters</p>
            )}
          </div>

          {/* Row count */}
          <p className="text-xs text-gray-400 text-right">
            {data.rows.length} rows · data partition: {data.latestDs}
          </p>
        </>
      )}
    </div>
  );
}

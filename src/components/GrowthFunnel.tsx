"use client";

import { useState, useEffect } from "react";

const API_URL = "/api/funnel";

interface FunnelMetric {
  section: string;
  metric: string;
  qtd: number | string | null;
  vsPacing: number | string | null;
  yoy: number | string | null;
  cohortedCvr: number | string | null;
  yoyPP: number | string | null;
  nptPct: number | string | null;
}

interface FunnelData {
  asOf: string;
  metrics: FunnelMetric[];
}

interface Section {
  name: string;
  metrics: FunnelMetric[];
}

const SECTION_COLORS: Record<string, { bg: string; border: string; header: string; accent: string }> = {
  Funnel: { bg: "bg-blue-50", border: "border-blue-200", header: "bg-blue-600", accent: "text-blue-700" },
  NPT: { bg: "bg-indigo-50", border: "border-indigo-200", header: "bg-indigo-600", accent: "text-indigo-700" },
  "New ACV Inputs": { bg: "bg-emerald-50", border: "border-emerald-200", header: "bg-emerald-600", accent: "text-emerald-700" },
  "Exp. ACV Inputs": { bg: "bg-amber-50", border: "border-amber-200", header: "bg-amber-600", accent: "text-amber-700" },
  "Attrition Inputs": { bg: "bg-red-50", border: "border-red-200", header: "bg-red-600", accent: "text-red-700" },
};

function formatValue(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "\u2014";
  if (typeof val === "string") return val;
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatPct(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "\u2014";
  if (typeof val === "string") {
    if (val.includes("%")) return val;
    const n = parseFloat(val);
    if (!isNaN(n)) return `${(n * 100).toFixed(0)}%`;
    return val;
  }
  if (Math.abs(val) <= 10) return `${(val * 100).toFixed(0)}%`;
  return `${val.toFixed(0)}%`;
}

function pacingColor(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "text-gray-400";
  const n = typeof val === "number" ? val : parseFloat(String(val).replace("%", ""));
  if (isNaN(n)) return "text-gray-400";
  const pct = Math.abs(n) <= 10 ? n * 100 : n;
  if (pct >= 95) return "text-green-700 bg-green-100";
  if (pct >= 80) return "text-amber-700 bg-amber-100";
  return "text-red-700 bg-red-100";
}

function yoyColor(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "text-gray-400";
  const str = String(val).replace("%", "");
  const n = parseFloat(str);
  if (isNaN(n)) return "text-gray-400";
  if (n > 0) return "text-green-700";
  if (n < 0) return "text-red-700";
  return "text-gray-600";
}

export function GrowthFunnel() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  useEffect(() => {
    fetch(API_URL)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading funnel data...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading funnel data</h3>
        <p className="text-sm">{error}</p>
        <p className="text-xs mt-2 text-red-600">Run <code className="bg-red-100 px-1 rounded">node scripts/fetch-funnel.mjs</code> to fetch the latest data.</p>
      </div>
    );
  }

  if (!data || !data.metrics.length) {
    return <div className="text-center py-12 text-gray-500">No funnel data available.</div>;
  }

  // Group metrics by section
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const m of data.metrics) {
    if (!current || current.name !== m.section) {
      current = { name: m.section, metrics: [] };
      sections.push(current);
    }
    current.metrics.push(m);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Growth Funnel</h2>
          {data.asOf && (
            <p className="text-xs text-gray-500">Data as of {data.asOf}</p>
          )}
        </div>
        <button
          onClick={() => setExpandedSection(expandedSection ? null : "all")}
          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 border border-gray-200 rounded-md"
        >
          {expandedSection === "all" ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Funnel visualization */}
      <div className="space-y-2">
        {sections.map((section) => {
          const colors = SECTION_COLORS[section.name] || SECTION_COLORS.Funnel;
          const isExpanded = expandedSection === "all" || expandedSection === section.name;

          return (
            <div key={section.name} className={`rounded-lg border ${colors.border} overflow-hidden`}>
              {/* Section header bar */}
              <button
                onClick={() => setExpandedSection(isExpanded ? null : section.name)}
                className={`w-full flex items-center justify-between px-4 py-3 ${colors.header} text-white text-left`}
              >
                <span className="font-semibold text-sm">{section.name}</span>
                <div className="flex items-center gap-4 text-xs">
                  {/* Show key summary metrics inline */}
                  {section.metrics.slice(-1).map((m) => (
                    <span key={m.metric} className="opacity-90">
                      {m.metric}: {formatValue(m.qtd)}
                    </span>
                  ))}
                  <span className="ml-2">{isExpanded ? "\u25B2" : "\u25BC"}</span>
                </div>
              </button>

              {/* Expanded metric table */}
              {isExpanded && (
                <div className={`${colors.bg}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-[280px]">Metric</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">QTD</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">vs Pacing</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">YoY</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Cohorted CVR</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">YOY PP</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">% NPT, YOY PP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.metrics.map((m) => {
                        const isComingSoon = m.metric.includes("Coming Soon");
                        return (
                          <tr
                            key={m.metric}
                            className={`border-b last:border-b-0 border-gray-100 ${isComingSoon ? "opacity-50 italic" : ""}`}
                          >
                            <td className={`px-4 py-2 font-medium ${colors.accent}`}>{m.metric}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-900">{formatValue(m.qtd)}</td>
                            <td className="px-4 py-2 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${pacingColor(m.vsPacing)}`}>
                                {formatPct(m.vsPacing)}
                              </span>
                            </td>
                            <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${yoyColor(m.yoy)}`}>
                              {formatPct(m.yoy)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                              {m.cohortedCvr ? String(m.cohortedCvr) : "\u2014"}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                              {m.yoyPP ? String(m.yoyPP) : "\u2014"}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                              {m.nptPct ? String(m.nptPct) : "\u2014"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* NNAOV callout */}
      {data.metrics.length > 0 && (() => {
        const nnaov = data.metrics.find((m) => m.metric === "NNAOV");
        const totalAcv = data.metrics.find((m) => m.metric === "Total ACV");
        if (!nnaov && !totalAcv) return null;
        return (
          <div className="mt-4 p-4 bg-gray-900 text-white rounded-lg flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Net New ACV Outstanding Value</p>
              <p className="text-2xl font-bold">{formatValue(nnaov?.qtd ?? null)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total ACV</p>
              <p className="text-2xl font-bold">{formatValue(totalAcv?.qtd ?? null)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase tracking-wide">NNAOV vs Pacing</p>
              <p className={`text-lg font-bold ${nnaov?.vsPacing ? "text-white" : "text-gray-500"}`}>
                {formatPct(nnaov?.vsPacing ?? null)}
              </p>
            </div>
          </div>
        );
      })()}

      <p className="text-xs text-gray-400 mt-2">
        *Expansion Excludes AI Add-on from FY26
      </p>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import type { DigestExperiment } from "@/lib/types";

function formatAcv(amount: number): string {
  if (amount === 0) return "$0";
  return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function inRange(dateStr: string | null, start: string, end: string): boolean {
  if (!dateStr) return false;
  return dateStr >= start && dateStr <= end;
}

function sumField(exps: DigestExperiment[], field: "estimatedAcv" | "actualAcv"): number {
  return exps.reduce((sum, e) => sum + (e[field] || 0), 0);
}

interface DateRanges {
  thisWeekStart: string;
  thisWeekEnd: string;
  monthStart: string;
  monthEnd: string;
  quarterStart: string;
  quarterEnd: string;
  quarterLabel: string;
  monthLabel: string;
  weekLabel: string;
}

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function ExperimentTable({ title, experiments, dateField, dateLabel }: {
  title: string;
  experiments: DigestExperiment[];
  dateField: "experimentStartDate" | "experimentEndDate" | "gaLaunchDate";
  dateLabel: string;
}) {
  if (experiments.length === 0) {
    return (
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{title}</h3>
        <p className="text-sm text-gray-400 italic">None this week</p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">
        {title} <span className="text-sm font-normal text-gray-400">({experiments.length})</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="pb-2 pr-4 font-medium">Key</th>
              <th className="pb-2 pr-4 font-medium">Summary</th>
              <th className="pb-2 pr-4 font-medium">DRI</th>
              <th className="pb-2 pr-4 font-medium">Growth Squad</th>
              <th className="pb-2 pr-4 font-medium text-right">Est. ACV</th>
              <th className="pb-2 pr-4 font-medium text-right">Actual ACV</th>
              <th className="pb-2 font-medium">{dateLabel}</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((exp) => (
              <tr key={exp.key} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 pr-4">
                  <a
                    href={exp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {exp.key}
                  </a>
                </td>
                <td className="py-2 pr-4 max-w-[300px] truncate">{exp.summary}</td>
                <td className="py-2 pr-4 text-gray-600">
                  {exp.experimentDri.length > 0
                    ? exp.experimentDri.map((d) => d.displayName).join(", ")
                    : "\u2014"}
                </td>
                <td className="py-2 pr-4 text-gray-600">{exp.growthSquad || "\u2014"}</td>
                <td className="py-2 pr-4 text-right text-gray-600">
                  {exp.estimatedAcv != null ? formatAcv(exp.estimatedAcv) : "\u2014"}
                </td>
                <td className="py-2 pr-4 text-right text-gray-600">
                  {exp.actualAcv != null ? formatAcv(exp.actualAcv) : "\u2014"}
                </td>
                <td className="py-2 text-gray-600">{formatShortDate(exp[dateField])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WbrDashboard({ jiraFilter }: { jiraFilter: string }) {
  const [experiments, setExperiments] = useState<DigestExperiment[]>([]);
  const [dates, setDates] = useState<DateRanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!jiraFilter) return;
    setLoading(true);
    setError(null);
    fetch(`/api/wbr?filter=${encodeURIComponent(jiraFilter)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setExperiments(data.experiments || []);
        setDates(data.dates || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jiraFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (!jiraFilter) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg mb-2">Select a JIRA filter to view WBR data</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading WBR data...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading WBR data</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!dates) return null;

  // Monthly buckets
  const expectedThisMonth = experiments.filter((e) =>
    inRange(e.expectedLaunchStartDate, dates.monthStart, dates.monthEnd)
  );
  const launchedThisMonth = experiments.filter((e) =>
    inRange(e.experimentStartDate, dates.monthStart, dates.monthEnd)
  );
  const gaThisMonth = experiments.filter((e) =>
    inRange(e.gaLaunchDate, dates.monthStart, dates.monthEnd)
  );

  // QTD bucket (fiscal quarter)
  const gaThisQuarter = experiments.filter((e) =>
    inRange(e.gaLaunchDate, dates.quarterStart, dates.quarterEnd)
  );

  // Weekly buckets
  const launchingThisWeek = experiments.filter((e) =>
    inRange(e.experimentStartDate, dates.thisWeekStart, dates.thisWeekEnd)
  );
  const endingThisWeek = experiments.filter((e) =>
    inRange(e.experimentEndDate, dates.thisWeekStart, dates.thisWeekEnd)
  );
  const gaThisWeek = experiments.filter((e) =>
    inRange(e.gaLaunchDate, dates.thisWeekStart, dates.thisWeekEnd)
  );

  return (
    <div className="space-y-8">
      {/* Monthly Summary */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Monthly Summary &mdash; {dates.monthLabel}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <SummaryCard
            label="Expected Launches"
            value={expectedThisMonth.length}
          />
          <SummaryCard
            label="Actually Launched"
            value={launchedThisMonth.length}
          />
          <SummaryCard
            label="Est. ACV (Launched)"
            value={formatAcv(sumField(launchedThisMonth, "estimatedAcv"))}
          />
          <SummaryCard
            label="GA'd This Month"
            value={gaThisMonth.length}
          />
          <SummaryCard
            label="Actual ACV (GA'd)"
            value={formatAcv(sumField(gaThisMonth, "actualAcv"))}
          />
          <SummaryCard
            label={`QTD Actual ACV (${dates.quarterLabel})`}
            value={formatAcv(sumField(gaThisQuarter, "actualAcv"))}
            sub={`${gaThisQuarter.length} experiments GA'd this quarter`}
          />
        </div>
      </div>

      {/* Weekly Summary */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Weekly Summary &mdash; {dates.weekLabel}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Launching This Week"
            value={launchingThisWeek.length}
            sub={`Est. ACV: ${formatAcv(sumField(launchingThisWeek, "estimatedAcv"))}`}
          />
          <SummaryCard
            label="Ending This Week"
            value={endingThisWeek.length}
            sub={`Est. ACV: ${formatAcv(sumField(endingThisWeek, "estimatedAcv"))}`}
          />
          <SummaryCard
            label="GA'ing This Week"
            value={gaThisWeek.length}
            sub={`Actual ACV: ${formatAcv(sumField(gaThisWeek, "actualAcv"))}`}
          />
          <SummaryCard
            label="Total Est. ACV (Week)"
            value={formatAcv(
              sumField(launchingThisWeek, "estimatedAcv") +
              sumField(endingThisWeek, "estimatedAcv")
            )}
          />
        </div>
      </div>

      {/* Experiment Lists */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <ExperimentTable
          title="Launching This Week"
          experiments={launchingThisWeek}
          dateField="experimentStartDate"
          dateLabel="Launch Date"
        />
        <ExperimentTable
          title="Ending This Week"
          experiments={endingThisWeek}
          dateField="experimentEndDate"
          dateLabel="End Date"
        />
        <ExperimentTable
          title="GA'ing This Week"
          experiments={gaThisWeek}
          dateField="gaLaunchDate"
          dateLabel="GA Date"
        />
      </div>
    </div>
  );
}

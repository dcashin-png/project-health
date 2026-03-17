"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  StripeTaxSnapshot,
  RaidItem,
  TimelineEvent,
  Workstream,
} from "@/lib/stripe-tax-types";

type RaidCategory = "all" | "risk" | "assumption" | "issue" | "dependency";

const STATUS_COLORS = {
  "on-track": { bg: "bg-green-100", text: "text-green-800", dot: "bg-green-500" },
  "at-risk": { bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-500" },
  blocked: { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-500" },
  complete: { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500" },
};

const TIMELINE_TYPE_COLORS: Record<string, string> = {
  milestone: "border-blue-500 bg-blue-50",
  blocker: "border-red-500 bg-red-50",
  decision: "border-purple-500 bg-purple-50",
  progress: "border-green-500 bg-green-50",
  upcoming: "border-gray-400 bg-gray-50",
};

const RAID_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  risk: { bg: "bg-red-100", text: "text-red-700" },
  assumption: { bg: "bg-blue-100", text: "text-blue-700" },
  issue: { bg: "bg-yellow-100", text: "text-yellow-700" },
  dependency: { bg: "bg-purple-100", text: "text-purple-700" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS["at-risk"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {status.replace("-", " ")}
    </span>
  );
}

function WorkstreamCard({ ws }: { ws: Workstream }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-semibold text-gray-900">{ws.name}</h4>
          <p className="text-xs text-gray-500">{ws.owner}</p>
        </div>
        <StatusBadge status={ws.status} />
      </div>
      <p className="text-sm text-gray-700 mb-2">{ws.summary}</p>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-blue-600 hover:underline"
      >
        {expanded ? "Hide" : "Show"} next steps ({ws.nextSteps.length})
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1">
          {ws.nextSteps.map((step, i) => (
            <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
              <span className="text-gray-400 mt-0.5">-</span>
              {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RaidTable({ items, filter }: { items: RaidItem[]; filter: RaidCategory }) {
  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);
  if (filtered.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No items in this category.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 text-gray-500 font-medium w-24">Type</th>
            <th className="text-left py-2 px-3 text-gray-500 font-medium">Item</th>
            <th className="text-left py-2 px-3 text-gray-500 font-medium w-40">Source</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 30).map((item) => {
            const catColor = RAID_CATEGORY_COLORS[item.category] || RAID_CATEGORY_COLORS.risk;
            return (
              <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${catColor.bg} ${catColor.text}`}>
                    {item.category}
                  </span>
                </td>
                <td className="py-2 px-3 text-gray-700">{item.title}</td>
                <td className="py-2 px-3 text-gray-500 text-xs">#{item.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length > 30 && (
        <p className="text-xs text-gray-400 mt-2 px-3">
          Showing 30 of {filtered.length} items
        </p>
      )}
    </div>
  );
}

function TimelineView({ events }: { events: TimelineEvent[] }) {
  // Group by month
  const grouped = new Map<string, TimelineEvent[]>();
  for (const ev of events) {
    const month = ev.date.slice(0, 7); // YYYY-MM
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month)!.push(ev);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([month, evts]) => (
        <div key={month}>
          <h4 className="text-sm font-semibold text-gray-900 mb-3 sticky top-0 bg-gray-50 py-1">
            {new Date(month + "-01").toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
            })}
          </h4>
          <div className="space-y-2 pl-4 border-l-2 border-gray-200">
            {evts.map((ev, i) => (
              <div
                key={i}
                className={`border-l-3 pl-3 py-2 rounded-r ${TIMELINE_TYPE_COLORS[ev.type] || TIMELINE_TYPE_COLORS.progress}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-gray-500">{ev.date}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-white/50 font-medium">
                    {ev.type}
                  </span>
                  {ev.source && (
                    <span className="text-xs text-gray-400">#{ev.source}</span>
                  )}
                </div>
                <p className="text-sm text-gray-800">{ev.title}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelActivityBar({ channels }: { channels: StripeTaxSnapshot["channels"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
      {channels.map((ch) => (
        <div
          key={ch.channelId}
          className="border border-gray-200 rounded-lg p-3 bg-white"
        >
          <p className="text-xs font-medium text-gray-900 truncate">
            #{ch.channelName}
          </p>
          <p className="text-lg font-bold text-gray-900">{ch.messageCount}</p>
          <p className="text-xs text-gray-500">messages</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {ch.topTopics.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SnapshotPicker({
  dates,
  selected,
  onSelect,
}: {
  dates: string[];
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  if (dates.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 font-medium">Snapshot:</label>
      <select
        value={selected || "live"}
        onChange={(e) =>
          onSelect(e.target.value === "live" ? null : e.target.value)
        }
        className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
      >
        <option value="live">Live (current)</option>
        {dates.map((d) => (
          <option key={d} value={d}>
            {new Date(d + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </option>
        ))}
      </select>
    </div>
  );
}

type SubTab = "workstreams" | "raid" | "timeline" | "channels";

export function StripeTaxDashboard() {
  const [snapshot, setSnapshot] = useState<StripeTaxSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("workstreams");
  const [raidFilter, setRaidFilter] = useState<RaidCategory>("all");
  const [snapshotDates, setSnapshotDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Load available snapshot dates
  useEffect(() => {
    fetch("/api/stripe-tax/snapshots")
      .then((r) => r.json())
      .then((data) => {
        if (data.dates) setSnapshotDates(data.dates);
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback((date: string | null) => {
    setLoading(true);
    setError(null);
    const url = date
      ? `/api/stripe-tax/snapshots?date=${date}`
      : "/api/stripe-tax";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setSnapshot(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData(selectedDate);
  }, [selectedDate, loadData]);

  const handleDateChange = (date: string | null) => {
    setSelectedDate(date);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Loading Stripe Tax project data from Slack channels...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading Stripe Tax data</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!snapshot) return null;

  const raidCounts = {
    all: snapshot.raid.length,
    risk: snapshot.raid.filter((r) => r.category === "risk").length,
    assumption: snapshot.raid.filter((r) => r.category === "assumption").length,
    issue: snapshot.raid.filter((r) => r.category === "issue").length,
    dependency: snapshot.raid.filter((r) => r.category === "dependency").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold text-gray-900">
              Stripe Tax Migration
            </h2>
            <StatusBadge status={snapshot.overallStatus} />
          </div>
          <p className="text-sm text-gray-600">{snapshot.statusSummary}</p>
          <p className="text-xs text-gray-400 mt-1">
            {selectedDate
              ? `Snapshot from ${snapshot.date}`
              : `Live data as of ${new Date(snapshot.capturedAt).toLocaleString()}`}
          </p>
        </div>
        <SnapshotPicker
          dates={snapshotDates}
          selected={selectedDate}
          onSelect={handleDateChange}
        />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(
          [
            { key: "workstreams", label: "Workstreams" },
            { key: "raid", label: `RAID (${snapshot.raid.length})` },
            { key: "timeline", label: `Timeline (${snapshot.timeline.length})` },
            { key: "channels", label: "Channels" },
          ] as { key: SubTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subTab === tab.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Workstreams */}
      {subTab === "workstreams" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshot.workstreams.map((ws) => (
            <WorkstreamCard key={ws.name} ws={ws} />
          ))}
        </div>
      )}

      {/* RAID */}
      {subTab === "raid" && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex gap-2 mb-4">
            {(
              ["all", "risk", "issue", "dependency", "assumption"] as RaidCategory[]
            ).map((cat) => (
              <button
                key={cat}
                onClick={() => setRaidFilter(cat)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  raidFilter === cat
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                <span className="ml-1 opacity-75">
                  ({raidCounts[cat]})
                </span>
              </button>
            ))}
          </div>
          <RaidTable items={snapshot.raid} filter={raidFilter} />
        </div>
      )}

      {/* Timeline */}
      {subTab === "timeline" && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <TimelineView events={snapshot.timeline} />
        </div>
      )}

      {/* Channels */}
      {subTab === "channels" && (
        <div>
          <ChannelActivityBar channels={snapshot.channels} />
        </div>
      )}
    </div>
  );
}

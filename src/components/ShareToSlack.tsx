"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ProjectHealth } from "@/lib/types";

function buildProjectBlock(data: ProjectHealth): string {
  const { project, health, summary, risks, issues, qualitativeHealth, experiments } = data;

  const healthEmoji =
    health === "needs-help" ? ":rotating_light:" :
    health === "at-risk" ? ":warning:" :
    health === "healthy" ? ":white_check_mark:" : ":grey_question:";

  const lines: string[] = [];
  const meta: string[] = [];
  if (project.lead) meta.push(project.lead);
  if (project.status) meta.push(project.status);
  const metaStr = meta.length > 0 ? ` — ${meta.join(" · ")}` : "";

  lines.push(`${healthEmoji} *<${project.url}|${project.name}>* (${project.key})${metaStr}`);
  if (summary) lines.push(`  _${summary}_`);

  if (qualitativeHealth && qualitativeHealth.signals.length > 0) {
    lines.push(`  Slack: ${qualitativeHealth.summary}`);
  }

  if (experiments && experiments.length > 0) {
    for (const exp of experiments) {
      const statusIcon =
        exp.status === "active" ? ":large_green_circle:" :
        exp.status === "finished" ? ":large_purple_circle:" :
        exp.status === "paused" ? ":large_yellow_circle:" : ":white_circle:";
      let detail = `  ${statusIcon} \`${exp.name}\` (${exp.status})`;
      if (exp.rolloutPercent !== null) detail += ` ${exp.rolloutPercent}%`;
      if (exp.exposureCount) detail += ` ${exp.exposureCount.toLocaleString()} exp.`;
      if (exp.srmIssue) detail += " :warning: SRM";
      lines.push(detail);

      const sigMetrics = (exp.metrics || []).filter((m) => m.isSignificant);
      if (sigMetrics.length > 0) {
        for (const m of sigMetrics) {
          const arrow = m.direction === "positive" ? ":arrow_up:" : ":arrow_down:";
          const effect = m.effectSize !== null ? `${(m.effectSize * 100).toFixed(1)}%` : "?";
          lines.push(`    ${arrow} ${m.metricName}: ${effect}*`);
        }
      }
    }
  }

  if (risks.length > 0) {
    for (const r of risks) lines.push(`  :red_circle: ${r}`);
  }
  if (issues.length > 0) {
    for (const r of issues) lines.push(`  :large_yellow_circle: ${r}`);
  }

  return lines.join("\n");
}

function buildSummaryMessage(projects: ProjectHealth[], view: "health" | "timeline"): string {
  const lines: string[] = [];

  // Header with counts
  const needsHelp = projects.filter((p) => p.needsLeadership).length;
  const atRisk = projects.filter((p) => p.health === "at-risk").length;
  const healthy = projects.filter((p) => p.health === "healthy").length;
  const unknown = projects.filter((p) => p.health === "unknown").length;
  const withExperiments = projects.filter((p) => p.experiments && p.experiments.length > 0).length;

  lines.push(`:bar_chart: *Project Health Summary* — ${projects.length} projects`);
  const counters: string[] = [];
  if (needsHelp > 0) counters.push(`:rotating_light: ${needsHelp} needs help`);
  if (atRisk > 0) counters.push(`:warning: ${atRisk} at risk`);
  if (healthy > 0) counters.push(`:white_check_mark: ${healthy} healthy`);
  if (unknown > 0) counters.push(`:grey_question: ${unknown} unknown`);
  if (counters.length > 0) lines.push(counters.join("  ·  "));

  if (withExperiments > 0) {
    const totalExp = projects.reduce((n, p) => n + (p.experiments?.length || 0), 0);
    const activeExp = projects.reduce((n, p) => n + (p.experiments?.filter((e) => e.status === "active").length || 0), 0);
    lines.push(`:test_tube: ${totalExp} Houston experiments across ${withExperiments} projects (${activeExp} active)`);
  }

  lines.push("");

  if (view === "timeline") {
    // Timeline view: group by status, show dates
    const withDates = projects.filter(
      (p) => p.project.experimentStartDate || p.project.launchStartDate
    );
    if (withDates.length > 0) {
      lines.push("*Timeline overview:*");
      for (const p of withDates) {
        const dates: string[] = [];
        if (p.project.experimentStartDate) dates.push(`exp: ${p.project.experimentStartDate}`);
        if (p.project.experimentEndDate) dates.push(`→ ${p.project.experimentEndDate}`);
        if (p.project.launchStartDate) dates.push(`launch: ${p.project.launchStartDate}`);
        lines.push(`• *<${p.project.url}|${p.project.name}>* — ${dates.join(" · ")}`);
      }
      lines.push("");
    }
  }

  // Projects needing attention first
  const attention = projects.filter((p) => p.needsLeadership || p.health === "at-risk");
  if (attention.length > 0) {
    lines.push(":rotating_light: *Needs attention:*");
    lines.push("");
    for (const p of attention) {
      lines.push(buildProjectBlock(p));
      lines.push("");
    }
  }

  // Healthy projects (condensed)
  const ok = projects.filter((p) => p.health === "healthy");
  if (ok.length > 0) {
    lines.push(":white_check_mark: *Healthy:*");
    for (const p of ok) {
      const expInfo = p.experiments && p.experiments.length > 0
        ? ` — ${p.experiments.length} experiment(s)`
        : "";
      lines.push(`• *<${p.project.url}|${p.project.name}>* — ${p.summary}${expInfo}`);
    }
    lines.push("");
  }

  // Unknown projects (condensed)
  const unk = projects.filter((p) => p.health === "unknown" && !p.needsLeadership);
  if (unk.length > 0) {
    lines.push(`:grey_question: *Unknown health (${unk.length}):* ${unk.map((p) => p.project.key).join(", ")}`);
  }

  return lines.join("\n").trim();
}

interface ChannelOption {
  id: string;
  name: string;
}

export function ShareToSlackButton({
  projects,
  view,
}: {
  projects: ProjectHealth[];
  view: "health" | "timeline";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelOption | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleOpen = () => {
    setOpen(true);
    setSent(false);
    setError(null);
    setMessage(buildSummaryMessage(projects, view));
    setSelectedChannel(null);
    setQuery("");
    setChannels([]);
  };

  const searchChannels = useCallback(async (q: string) => {
    if (q.length < 2) {
      setChannels([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/slack/channels?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setChannels(data.channels || []);
    } catch {
      setChannels([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedChannel(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchChannels(value), 300);
  };

  const handleSend = async () => {
    if (!selectedChannel || !message) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: selectedChannel.id, message }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Failed to send");
      } else {
        setSent(true);
      }
    } catch {
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (projects.length === 0) return null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 transition-colors"
      >
        Share to Slack
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div ref={modalRef} className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Share to Slack</h3>
                <p className="text-xs text-gray-500">{projects.length} projects · {view} view</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-4">
              {/* Channel picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                {selectedChannel ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-gray-50">
                    <span className="text-sm font-medium">#{selectedChannel.name}</span>
                    <button
                      onClick={() => { setSelectedChannel(null); setQuery(""); }}
                      className="text-gray-400 hover:text-gray-600 text-xs ml-auto"
                    >
                      change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => handleQueryChange(e.target.value)}
                      placeholder="Search for a channel..."
                      className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    {searching && (
                      <span className="absolute right-3 top-2.5 text-xs text-gray-400">searching...</span>
                    )}
                    {channels.length > 0 && (
                      <ul className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {channels.map((ch) => (
                          <li key={ch.id}>
                            <button
                              onClick={() => { setSelectedChannel(ch); setChannels([]); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                            >
                              #{ch.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Message preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message preview</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={16}
                  className="w-full px-3 py-2 border rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {message.length} / 5000 characters
                  {message.length > 5000 && <span className="text-red-500 ml-1">(over limit — message will be truncated)</span>}
                </p>
              </div>

              {error && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              {sent && (
                <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  Message sent to #{selectedChannel?.name}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                {sent ? "Close" : "Cancel"}
              </button>
              {!sent && (
                <button
                  onClick={handleSend}
                  disabled={!selectedChannel || !message || sending || message.length > 5000}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

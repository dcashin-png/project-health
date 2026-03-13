"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CleanupExperiment } from "@/lib/types";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "2-digit" });
}

function daysPast(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function describeIssue(exp: CleanupExperiment): string {
  const startPast = daysPast(exp.experimentStartDate);
  const endPast = daysPast(exp.experimentEndDate);

  if (startPast !== null && startPast > 0 && (exp.experimentStatus === "Planning" || exp.experimentStatus === "Development")) {
    return `Experiment start date was *${formatDate(exp.experimentStartDate)}* (${startPast}d ago) but status is still *${exp.experimentStatus}*`;
  }
  if (endPast !== null && endPast > 0 && exp.status !== "Done") {
    return `Experiment end date was *${formatDate(exp.experimentEndDate)}* (${endPast}d ago) but Jira status is *${exp.status}*`;
  }
  return `Status needs review`;
}

const EXPERIMENT_STATUSES = [
  "Planning",
  "Development",
  "Running",
  "Analysis",
  "Paused / Issues",
  "Concluded Control",
  "GA Complete",
  "Cancelled",
];

interface SlackUser {
  slackId: string;
  displayName: string;
}

interface ChannelOption {
  id: string;
  name: string;
}

function buildSlackMessage(
  experiments: CleanupExperiment[],
  userMap: Record<string, SlackUser | null>,
  intro: string,
  pmOverrides: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push(intro);
  lines.push("");

  for (const exp of experiments) {
    // Find the PM to mention — use override if set
    let mention = "";
    const override = pmOverrides[exp.key];
    const lookupName = override || exp.productManager?.name;
    if (lookupName) {
      const user = userMap[lookupName];
      if (user) {
        mention = `<@${user.slackId}>`;
      } else {
        mention = override || exp.productManager?.displayName || "";
      }
    }
    if (!mention && exp.assignee) {
      mention = exp.assignee;
    }

    const issue = describeIssue(exp);
    lines.push(`• ${mention ? mention + ": " : ""}*<${exp.url}|${exp.summary}>:* ${issue}.`);
  }

  return lines.join("\n");
}

export function ExperimentCleanup() {
  const [experiments, setExperiments] = useState<CleanupExperiment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Slack user lookup cache
  const [userMap, setUserMap] = useState<Record<string, SlackUser | null>>({});
  const [lookingUpUsers, setLookingUpUsers] = useState(false);

  // Preview/send state
  const [showPreview, setShowPreview] = useState(false);
  const [intro, setIntro] = useState(
    "Hello! We have a handful of experiments that need cleanup this week. Let's get these updated by Monday!"
  );
  const [message, setMessage] = useState("");

  // Channel picker state
  const [channelQuery, setChannelQuery] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [searchingChannels, setSearchingChannels] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelOption | null>(null);
  const [threadTs, setThreadTs] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Send state
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // PM name overrides for Slack lookup (keyed by issue key)
  const [pmOverrides, setPmOverrides] = useState<Record<string, string>>({});

  // Jira update state
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [updateResults, setUpdateResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const updateField = async (
    issueKey: string,
    payload: Record<string, string | null>,
    localUpdate: (exp: CleanupExperiment) => CleanupExperiment,
    label: string,
  ) => {
    const updateKey = `${issueKey}:${Object.keys(payload).join(",")}`;
    setUpdating((prev) => ({ ...prev, [updateKey]: true }));
    setUpdateResults((prev) => {
      const next = { ...prev };
      delete next[updateKey];
      return next;
    });
    try {
      const res = await fetch("/api/experiment-cleanup/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueKey, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUpdateResults((prev) => ({ ...prev, [updateKey]: { ok: false, message: data.error } }));
      } else {
        setUpdateResults((prev) => ({ ...prev, [updateKey]: { ok: true, message: label } }));
        setExperiments((prev) => prev.map((e) => (e.key === issueKey ? localUpdate(e) : e)));
        // Clear success message after 3s
        setTimeout(() => {
          setUpdateResults((prev) => {
            const next = { ...prev };
            delete next[updateKey];
            return next;
          });
        }, 3000);
      }
    } catch {
      setUpdateResults((prev) => ({ ...prev, [updateKey]: { ok: false, message: "Update failed" } }));
    } finally {
      setUpdating((prev) => ({ ...prev, [updateKey]: false }));
    }
  };

  const updateExperimentStatus = (issueKey: string, newStatus: string) =>
    updateField(
      issueKey,
      { experimentStatus: newStatus },
      (e) => ({ ...e, experimentStatus: newStatus }),
      `Status → ${newStatus}`,
    );

  const updateStartDate = (issueKey: string, date: string) =>
    updateField(
      issueKey,
      { experimentStartDate: date || null },
      (e) => ({ ...e, experimentStartDate: date || null }),
      date ? `Start → ${date}` : "Start date cleared",
    );

  const updateEndDate = (issueKey: string, date: string) =>
    updateField(
      issueKey,
      { experimentEndDate: date || null },
      (e) => ({ ...e, experimentEndDate: date || null }),
      date ? `End → ${date}` : "End date cleared",
    );

  useEffect(() => {
    fetch("/api/experiment-cleanup")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setExperiments(data.experiments || []);
        // Select all by default
        setSelected(new Set((data.experiments || []).map((e: CleanupExperiment) => e.key)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === experiments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(experiments.map((e) => e.key)));
    }
  };

  const lookupUsers = useCallback(async (exps: CleanupExperiment[]) => {
    const namesToLookup = new Set<string>();
    for (const exp of exps) {
      const override = pmOverrides[exp.key];
      const lookupName = override || exp.productManager?.name;
      if (lookupName && !userMap[lookupName]) {
        namesToLookup.add(lookupName);
      }
    }

    if (namesToLookup.size === 0) return;

    setLookingUpUsers(true);
    try {
      const res = await fetch(
        `/api/slack/lookup-users?names=${encodeURIComponent([...namesToLookup].join(","))}`
      );
      const data = await res.json();
      setUserMap((prev) => ({ ...prev, ...data.users }));
    } catch {
      // Proceed without Slack mentions
    } finally {
      setLookingUpUsers(false);
    }
  }, [userMap, pmOverrides]);

  const handlePreview = async () => {
    const selectedExps = experiments.filter((e) => selected.has(e.key));
    await lookupUsers(selectedExps);
    setShowPreview(true);
    setSent(false);
    setSendError(null);
  };

  // Rebuild message when preview opens or inputs change
  useEffect(() => {
    if (!showPreview) return;
    const selectedExps = experiments.filter((e) => selected.has(e.key));
    setMessage(buildSlackMessage(selectedExps, userMap, intro, pmOverrides));
  }, [showPreview, selected, userMap, intro, experiments, pmOverrides]);

  const searchChannels = useCallback(async (q: string) => {
    if (q.length < 2) {
      setChannels([]);
      return;
    }
    setSearchingChannels(true);
    try {
      const res = await fetch(`/api/slack/channels?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setChannels(data.channels || []);
    } catch {
      setChannels([]);
    } finally {
      setSearchingChannels(false);
    }
  }, []);

  const handleChannelQuery = (value: string) => {
    setChannelQuery(value);
    setSelectedChannel(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchChannels(value), 300);
  };

  const handleSend = async () => {
    if (!selectedChannel || !message) return;
    setSending(true);
    setSendError(null);
    try {
      const body: Record<string, string> = {
        channelId: selectedChannel.id,
        message,
      };
      if (threadTs.trim()) {
        body.thread_ts = threadTs.trim();
      }
      const res = await fetch("/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        setSendError(result.error || "Failed to send");
      } else {
        setSent(true);
      }
    } catch {
      setSendError("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading experiments...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading experiments</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (experiments.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg mb-2">No experiments need cleanup</p>
        <p className="text-sm">All experiment statuses and dates look consistent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {experiments.length} experiment{experiments.length !== 1 ? "s" : ""} with date/status mismatches
          {selected.size > 0 && (
            <span className="ml-2 font-medium text-gray-900">
              · {selected.size} selected
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-md hover:bg-gray-50"
          >
            {selected.size === experiments.length ? "Deselect all" : "Select all"}
          </button>
          <button
            onClick={handlePreview}
            disabled={selected.size === 0 || lookingUpUsers}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lookingUpUsers ? "Looking up users..." : `Preview Slack post (${selected.size})`}
          </button>
        </div>
      </div>

      {/* Experiment list */}
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {experiments.map((exp) => {
          const startDays = daysPast(exp.experimentStartDate);
          const endDays = daysPast(exp.experimentEndDate);
          const isStartIssue = startDays !== null && startDays > 0 &&
            (exp.experimentStatus === "Planning" || exp.experimentStatus === "Development");
          const isEndIssue = endDays !== null && endDays > 0 && exp.status !== "Done";

          return (
            <label
              key={exp.key}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                selected.has(exp.key) ? "bg-blue-50/50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(exp.key)}
                onChange={() => toggleSelect(exp.key)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={exp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {exp.key}
                  </a>
                  <span className="text-sm text-gray-900 truncate">{exp.summary}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                  {/* Experiment Status dropdown */}
                  <select
                    value={exp.experimentStatus}
                    onChange={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      updateExperimentStatus(exp.key, e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={updating[exp.key]}
                    className={`rounded-full px-2 py-0.5 font-medium border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${
                      updating[exp.key]
                        ? "bg-gray-50 text-gray-400"
                        : exp.experimentStatus === "Planning"
                          ? "bg-gray-100 text-gray-700"
                          : exp.experimentStatus === "Development"
                            ? "bg-blue-100 text-blue-700"
                            : exp.experimentStatus === "Running"
                              ? "bg-green-100 text-green-700"
                              : exp.experimentStatus === "Analysis"
                                ? "bg-purple-100 text-purple-700"
                                : exp.experimentStatus === "Paused / Issues"
                                  ? "bg-amber-100 text-amber-700"
                                  : exp.experimentStatus === "Concluded Control"
                                    ? "bg-rose-100 text-rose-700"
                                    : exp.experimentStatus === "GA Complete"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : exp.experimentStatus === "Cancelled"
                                        ? "bg-red-100 text-red-700"
                                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {EXPERIMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    {!EXPERIMENT_STATUSES.includes(exp.experimentStatus) && (
                      <option value={exp.experimentStatus}>{exp.experimentStatus}</option>
                    )}
                  </select>
                  {/* Saving / result indicators */}
                  {Object.keys(updating).filter((k) => k.startsWith(exp.key + ":") && updating[k]).length > 0 && (
                    <span className="text-gray-400">saving...</span>
                  )}
                  {Object.keys(updateResults)
                    .filter((k) => k.startsWith(exp.key + ":"))
                    .map((k) => (
                      <span key={k} className={updateResults[k].ok ? "text-green-600" : "text-red-600"}>
                        {updateResults[k].message}
                      </span>
                    ))}
                  {/* Jira status */}
                  <span>Jira: {exp.status}</span>
                  {/* Start date */}
                  <span className={`inline-flex items-center gap-1 ${isStartIssue ? "text-amber-600 font-medium" : ""}`}>
                    Start:
                    <input
                      type="date"
                      value={exp.experimentStartDate || ""}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateStartDate(exp.key, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="border border-gray-200 rounded px-1 py-0 text-xs bg-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    {isStartIssue && <span>({startDays}d ago)</span>}
                  </span>
                  {/* End date */}
                  <span className={`inline-flex items-center gap-1 ${isEndIssue ? "text-red-600 font-medium" : ""}`}>
                    End:
                    <input
                      type="date"
                      value={exp.experimentEndDate || ""}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateEndDate(exp.key, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="border border-gray-200 rounded px-1 py-0 text-xs bg-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    {isEndIssue && <span>({endDays}d ago)</span>}
                  </span>
                  {/* PM with override */}
                  <span className="inline-flex items-center gap-1">
                    PM:
                    <input
                      type="text"
                      value={pmOverrides[exp.key] ?? exp.productManager?.name ?? ""}
                      onChange={(e) => {
                        e.stopPropagation();
                        setPmOverrides((prev) => ({ ...prev, [exp.key]: e.target.value }));
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Slack lookup name"
                      className="border border-gray-200 rounded px-1.5 py-0 text-xs w-28 bg-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    {exp.productManager && !pmOverrides[exp.key] && (
                      <span className="text-gray-400">({exp.productManager.displayName})</span>
                    )}
                  </span>
                  {/* Squad */}
                  {exp.growthSquad && <span>Squad: {exp.growthSquad}</span>}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Preview Slack Post</h3>
                <p className="text-xs text-gray-500">{selected.size} experiments selected</p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                &times;
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-4">
              {/* Channel picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                {selectedChannel ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-gray-50">
                    <span className="text-sm font-medium">#{selectedChannel.name}</span>
                    <button
                      onClick={() => { setSelectedChannel(null); setChannelQuery(""); }}
                      className="text-gray-400 hover:text-gray-600 text-xs ml-auto"
                    >
                      change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={channelQuery}
                      onChange={(e) => handleChannelQuery(e.target.value)}
                      placeholder="Search for a channel..."
                      className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    {searchingChannels && (
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

              {/* Thread TS (optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Thread <span className="text-gray-400 font-normal">(optional — paste a Slack URL or timestamp to reply in a thread)</span>
                </label>
                <input
                  type="text"
                  value={threadTs}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Auto-extract thread_ts from Slack URLs
                    const tsMatch = val.match(/thread_ts=([0-9.]+)/);
                    if (tsMatch) {
                      setThreadTs(tsMatch[1]);
                    } else {
                      // Also handle /pTIMESTAMP format (no dot — insert it)
                      const pMatch = val.match(/\/p(\d{10})(\d{6})/);
                      if (pMatch) {
                        setThreadTs(`${pMatch[1]}.${pMatch[2]}`);
                      } else {
                        setThreadTs(val);
                      }
                    }
                  }}
                  placeholder="Paste Slack URL or timestamp (e.g. 1772812812.327729)"
                  className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Intro text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Intro message</label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              {/* Message preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message preview</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={14}
                  className="w-full px-3 py-2 border rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {message.length} / 5000 characters
                  {message.length > 5000 && (
                    <span className="text-red-500 ml-1">(over limit)</span>
                  )}
                </p>
              </div>

              {sendError && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {sendError}
                </div>
              )}

              {sent && (
                <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  Message sent to #{selectedChannel?.name}
                  {threadTs && " (in thread)"}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPreview(false)}
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
                  {sending ? "Sending..." : "Post to Slack"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

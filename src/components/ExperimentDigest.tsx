"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { DigestExperiment } from "@/lib/types";

// --- Helpers ---

function formatAcv(amount: number): string {
  if (amount === 0) return "$0";
  return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateRangeLong(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sMonth = s.toLocaleDateString("en-US", { month: "long" });
  const eMonth = e.toLocaleDateString("en-US", { month: "long" });
  if (sMonth === eMonth) {
    return `${sMonth} ${ordinal(s.getDate())} - ${sMonth} ${ordinal(e.getDate())}`;
  }
  return `${sMonth} ${ordinal(s.getDate())} - ${eMonth} ${ordinal(e.getDate())}`;
}

function getMonthName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long" });
}

function inRange(dateStr: string | null, start: string, end: string): boolean {
  if (!dateStr) return false;
  return dateStr >= start && dateStr <= end;
}

function sumAcv(exps: DigestExperiment[], field: "estimatedAcv" | "actualAcv"): number {
  return exps.reduce((sum, e) => sum + (e[field] || 0), 0);
}

// --- Types ---

type SectionKey = "launched" | "gad" | "launching" | "ending" | "roadmap" | "roadmapGad";

interface DateRanges {
  lastWeekStart: string;
  lastWeekEnd: string;
  thisWeekStart: string;
  thisWeekEnd: string;
  monthStart: string;
  monthEnd: string;
  nextMonthStart: string;
  nextMonthEnd: string;
}

interface SlackCandidate {
  slackId: string;
  displayName: string;
  title: string | null;
  avatar: string | null;
}

interface SlackUser {
  slackId: string;
  displayName: string;
  avatar: string | null;
}

interface ChannelOption {
  id: string;
  name: string;
}

// --- Slack Message Builder ---

function buildSlackMessage(
  sections: Record<SectionKey, DigestExperiment[]>,
  selections: Record<SectionKey, Set<string>>,
  userMap: Record<string, SlackUser | null>,
  driOverrides: Record<string, string>,
  dates: DateRanges,
  monthlyMetrics: { velocity: number; estAcv: number; successRate: number; actualAcv: number },
): string {
  const lines: string[] = [];
  const month = getMonthName(dates.monthStart);
  const today = new Date();
  const todayStr = `${month} ${ordinal(today.getDate())}`;

  // Header
  lines.push(`:holi: :basketball: **${month} Metrics** :basketball: :holi:`);
  lines.push(`Velocity (# of experiments)\t**${monthlyMetrics.velocity}**`);
  lines.push(`Estimated ACV impact (#) as of ${todayStr}\t**${formatAcv(monthlyMetrics.estAcv)}**`);
  lines.push(`Success Rate (# GA'd)\t**${monthlyMetrics.successRate}**`);
  lines.push(`Actual ACV impact ($)\t**${formatAcv(monthlyMetrics.actualAcv)}**`);
  lines.push("");

  const getDriMention = (exp: DigestExperiment) => {
    const driName = driOverrides[exp.key] || exp.experimentDri[0]?.displayName || "";
    if (!driName) return "`Unknown`";
    const user = userMap[driName];
    if (user) return `<@${user.slackId}>`;
    return driName;
  };

  const formatAcvOrUnknown = (val: number | null): string => {
    if (val === null) return "`Unknown`";
    return formatAcv(val);
  };

  const expLine = (exp: DigestExperiment, dateField: "experimentStartDate" | "experimentEndDate" | "gaLaunchDate" | "expectedLaunchStartDate", acvLabel: string, acvField: "estimatedAcv" | "actualAcv") => {
    const date = exp[dateField] ? formatShortDate(exp[dateField]) : "`Unknown`";
    const dri = getDriMention(exp);
    const acv = formatAcvOrUnknown(exp[acvField]);
    return `    \u25e6 ${date}: <${exp.url}|${exp.summary}> | ${acvLabel}: ${acv} | DRI: ${dri}`;
  };

  // Last week
  const lastWeekRange = formatDateRangeLong(dates.lastWeekStart, dates.lastWeekEnd);
  lines.push(`**Last week: ${lastWeekRange}**`);

  const launched = sections.launched.filter((e) => selections.launched.has(e.key));
  const launchedAcv = sumAcv(launched, "estimatedAcv");
  lines.push(`\u2022 **Launched last week: ${launched.length} | Total Estimated ACV Value: ${formatAcv(launchedAcv)}**`);
  for (const exp of launched) {
    lines.push(expLine(exp, "experimentStartDate", "Estimated ACV", "estimatedAcv"));
  }

  const gad = sections.gad.filter((e) => selections.gad.has(e.key));
  const gadAcv = sumAcv(gad, "actualAcv");
  lines.push(`\u2022 **Experiments GA'd last week: ${gad.length} | Total Actual ACV: ${formatAcv(gadAcv)}**`);
  for (const exp of gad) {
    lines.push(expLine(exp, "expectedLaunchStartDate", "Actual ACV", "actualAcv"));
  }

  // This week
  lines.push("");
  const thisWeekRange = formatDateRangeLong(dates.thisWeekStart, dates.thisWeekEnd);
  lines.push(`**This week: ${thisWeekRange}**`);

  const launching = sections.launching.filter((e) => selections.launching.has(e.key));
  const launchingAcv = sumAcv(launching, "estimatedAcv");
  lines.push(`\u2022 **Planned Launches this week ${launching.length} | Estimated ACV: ${formatAcv(launchingAcv)}**`);
  for (const exp of launching) {
    lines.push(expLine(exp, "experimentStartDate", "Estimated ACV", "estimatedAcv"));
  }

  const ending = sections.ending.filter((e) => selections.ending.has(e.key));
  const endingAcv = sumAcv(ending, "estimatedAcv");
  lines.push(`\u2022 **Experiments Ending this week: ${ending.length} | Estimated ACV: ${formatAcv(endingAcv)}**`);
  for (const exp of ending) {
    lines.push(expLine(exp, "experimentEndDate", "Estimated ACV", "estimatedAcv"));
  }

  // Footer — blank line to separate from experiment sections
  lines.push("");
  const dashboardUrl = "https://jira.tinyspeck.com/secure/Dashboard.jspa?selectPageId=25808";
  lines.push(`All data is pulled from the :flying_saucer: <${dashboardUrl}|FY'27 Growth Mothership>`);
  lines.push(`\u2022 **Planned Experiments Starting:** See complete list of <${dashboardUrl}#Custom-Charts/46186|experiments> and <${dashboardUrl}#Custom-Charts/46347|experiment epics>`);
  lines.push(`\u2022 **Planned Experiments GAing:** See complete list of <${dashboardUrl}#Custom-Charts/46188|GAed items>`);
  lines.push(`\u2022 **Experiments that ended 30 days ago:** see complete list of <${dashboardUrl}#Custom-Charts/46421|experiments>`);
  lines.push(`\u2022 **Experiments ending in 30 days:** see complete list of <${dashboardUrl}#Custom-Charts/46187|experiments>`);

  return lines.join("\n");
}

function buildMonthlyMessage(
  roadmap: DigestExperiment[],
  roadmapSelected: Set<string>,
  gadExps: DigestExperiment[],
  gadSelected: Set<string>,
  userMap: Record<string, SlackUser | null>,
  driOverrides: Record<string, string>,
  dates: DateRanges,
  whichMonth: "current" | "next",
): string {
  const lines: string[] = [];
  const month = getMonthName(whichMonth === "current" ? dates.monthStart : dates.nextMonthStart);

  const getDriMention = (exp: DigestExperiment) => {
    const driName = driOverrides[exp.key] || exp.experimentDri[0]?.displayName || "";
    if (!driName) return "`Unknown`";
    const user = userMap[driName];
    if (user) return `<@${user.slackId}>`;
    return driName;
  };

  const formatAcvOrUnknown = (val: number | null): string => {
    if (val === null) return "`Unknown`";
    return formatAcv(val);
  };

  // Roadmap section
  const filtered = roadmap.filter((e) => roadmapSelected.has(e.key));
  const totalAcv = sumAcv(filtered, "estimatedAcv");

  lines.push(`:calendar: **${month} Experiment Roadmap: ${filtered.length} experiments | Total Estimated ACV: ${formatAcv(totalAcv)}**`);
  for (const exp of filtered) {
    const date = exp.experimentStartDate ? formatShortDate(exp.experimentStartDate) : "`Unknown`";
    const dri = getDriMention(exp);
    const acv = formatAcvOrUnknown(exp.estimatedAcv);
    lines.push(`    \u25e6 ${date}: <${exp.url}|${exp.summary}> | Estimated ACV: ${acv} | DRI: ${dri}`);
  }

  // GA'd section
  const gadFiltered = gadExps.filter((e) => gadSelected.has(e.key));
  const gadTotalAcv = sumAcv(gadFiltered, "actualAcv");

  lines.push("");
  lines.push(`:white_check_mark: **${month} GA'd: ${gadFiltered.length} experiments | Total Actual ACV: ${formatAcv(gadTotalAcv)}**`);
  for (const exp of gadFiltered) {
    const date = exp.expectedLaunchStartDate ? formatShortDate(exp.expectedLaunchStartDate) : "`Unknown`";
    const dri = getDriMention(exp);
    const acv = formatAcvOrUnknown(exp.actualAcv);
    lines.push(`    \u25e6 ${date}: <${exp.url}|${exp.summary}> | Actual ACV: ${acv} | DRI: ${dri}`);
  }

  return lines.join("\n");
}

// --- Component ---

export function ExperimentDigest() {
  const [experiments, setExperiments] = useState<DigestExperiment[]>([]);
  const [dates, setDates] = useState<DateRanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selections per section
  const [selections, setSelections] = useState<Record<SectionKey, Set<string>>>({
    launched: new Set(),
    gad: new Set(),
    launching: new Set(),
    ending: new Set(),
    roadmap: new Set(),
    roadmapGad: new Set(),
  });

  // Roadmap month toggle
  const [roadmapMonth, setRoadmapMonth] = useState<"current" | "next">("current");

  // DRI overrides
  const [driOverrides, setDriOverrides] = useState<Record<string, string>>({});

  // Slack user lookup
  const [candidateMap, setCandidateMap] = useState<Record<string, SlackCandidate[]>>({});
  const [userMap, setUserMap] = useState<Record<string, SlackUser | null>>({});
  const [lookingUpUsers, setLookingUpUsers] = useState(false);

  // Preview/send state — "weekly" or "monthly" or null
  const [previewMode, setPreviewMode] = useState<"weekly" | "monthly" | null>(null);
  const [message, setMessage] = useState("");

  // Channel picker
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

  // Categorize experiments into sections
  const sections = useMemo<Record<SectionKey, DigestExperiment[]>>(() => {
    if (!dates) return { launched: [], gad: [], launching: [], ending: [], roadmap: [], roadmapGad: [] };
    return {
      launched: experiments.filter((e) => inRange(e.experimentStartDate, dates.lastWeekStart, dates.lastWeekEnd)),
      gad: experiments.filter((e) => inRange(e.expectedLaunchStartDate, dates.lastWeekStart, dates.lastWeekEnd) && (e.status === "Done" || e.experimentStatus === "GA Complete") && e.experimentStartDate !== null && e.experimentEndDate !== null),
      launching: experiments.filter((e) => inRange(e.experimentStartDate, dates.thisWeekStart, dates.thisWeekEnd)),
      ending: experiments.filter((e) => inRange(e.experimentEndDate, dates.thisWeekStart, dates.thisWeekEnd)),
      roadmap: experiments.filter((e) => {
        const mStart = roadmapMonth === "current" ? dates.monthStart : dates.nextMonthStart;
        const mEnd = roadmapMonth === "current" ? dates.monthEnd : dates.nextMonthEnd;
        return inRange(e.experimentStartDate, mStart, mEnd) && (e.estimatedAcv !== null && e.estimatedAcv > 0);
      }),
      roadmapGad: experiments.filter((e) => {
        const mStart = roadmapMonth === "current" ? dates.monthStart : dates.nextMonthStart;
        const mEnd = roadmapMonth === "current" ? dates.monthEnd : dates.nextMonthEnd;
        return inRange(e.expectedLaunchStartDate, mStart, mEnd)
          && (e.status === "Done" || e.experimentStatus === "GA Complete")
          && e.experimentStartDate !== null
          && e.experimentEndDate !== null;
      }),
    };
  }, [experiments, dates, roadmapMonth]);

  // Monthly metrics
  const monthlyMetrics = useMemo(() => {
    if (!dates) return { velocity: 0, estAcv: 0, successRate: 0, actualAcv: 0 };
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const excludedStatuses = ["Paused/Issues", "Cancelled"];
    const velocityExps = experiments.filter((e) =>
      inRange(e.experimentStartDate, dates.monthStart, yesterdayStr)
      && !excludedStatuses.includes(e.experimentStatus)
    );
    const gadThisMonth = experiments.filter((e) =>
      inRange(e.expectedLaunchStartDate, dates.monthStart, dates.thisWeekEnd)
      && (e.status === "Done" || e.experimentStatus === "GA Complete")
      && e.experimentStartDate !== null
      && e.experimentEndDate !== null
    );
    return {
      velocity: velocityExps.length,
      estAcv: sumAcv(velocityExps, "estimatedAcv"),
      successRate: gadThisMonth.length,
      actualAcv: sumAcv(gadThisMonth, "actualAcv"),
    };
  }, [experiments, dates]);

  // Fetch data
  useEffect(() => {
    fetch("/api/experiment-digest")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setExperiments(data.experiments || []);
        setDates(data.dates);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Initialize selections when sections change
  useEffect(() => {
    setSelections({
      launched: new Set(sections.launched.map((e) => e.key)),
      gad: new Set(sections.gad.map((e) => e.key)),
      launching: new Set(sections.launching.map((e) => e.key)),
      ending: new Set(sections.ending.map((e) => e.key)),
      roadmap: new Set(sections.roadmap.map((e) => e.key)),
      roadmapGad: new Set(sections.roadmapGad.map((e) => e.key)),
    });
  }, [sections]);

  const toggleSelect = (section: SectionKey, key: string) => {
    setSelections((prev) => {
      const next = new Set(prev[section]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [section]: next };
    });
  };

  const toggleAllInSection = (section: SectionKey) => {
    setSelections((prev) => {
      const sectionExps = sections[section];
      const allSelected = sectionExps.every((e) => prev[section].has(e.key));
      return {
        ...prev,
        [section]: allSelected ? new Set<string>() : new Set(sectionExps.map((e) => e.key)),
      };
    });
  };

  // Slack user lookup
  const lookupUsers = useCallback(async (exps: DigestExperiment[]) => {
    const toLookup: { name: string; email: string }[] = [];
    const seen = new Set<string>();
    for (const exp of exps) {
      const name = driOverrides[exp.key] || exp.experimentDri[0]?.displayName;
      if (name && !seen.has(name)) {
        seen.add(name);
        const email = exp.experimentDri[0]?.email || "";
        toLookup.push({ name, email });
      }
    }
    if (toLookup.length === 0) return;

    setLookingUpUsers(true);
    try {
      const names = toLookup.map((l) => l.name).join(",");
      const emails = toLookup.map((l) => l.email).join(",");
      const res = await fetch(
        `/api/slack/lookup-users?names=${encodeURIComponent(names)}&emails=${encodeURIComponent(emails)}`
      );
      const data = await res.json();
      const newCandidates: Record<string, SlackCandidate[]> = data.candidates || {};
      setCandidateMap((prev) => ({ ...prev, ...newCandidates }));

      // Auto-select when there's exactly 1 candidate
      const autoSelected: Record<string, SlackUser | null> = {};
      for (const [name, candidates] of Object.entries(newCandidates)) {
        if (candidates.length === 1) {
          autoSelected[name] = candidates[0];
        }
      }
      if (Object.keys(autoSelected).length > 0) {
        setUserMap((prev) => ({ ...prev, ...autoSelected }));
      }
    } catch {
      // Proceed without Slack mentions
    } finally {
      setLookingUpUsers(false);
    }
  }, [driOverrides]);

  // Auto-lookup users when experiments load
  useEffect(() => {
    if (experiments.length > 0) {
      lookupUsers(experiments);
    }
  }, [experiments]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSlackUser = (driName: string, slackId: string) => {
    const candidates = candidateMap[driName] || [];
    const candidate = candidates.find((c) => c.slackId === slackId);
    if (candidate) {
      setUserMap((prev) => ({ ...prev, [driName]: candidate }));
    }
  };

  const handlePreview = async (mode: "weekly" | "monthly") => {
    await lookupUsers(experiments);
    setPreviewMode(mode);
    setSent(false);
    setSendError(null);
  };

  // Rebuild message when preview or inputs change
  useEffect(() => {
    if (!previewMode || !dates) return;
    if (previewMode === "weekly") {
      setMessage(buildSlackMessage(sections, selections, userMap, driOverrides, dates, monthlyMetrics));
    } else {
      setMessage(buildMonthlyMessage(sections.roadmap, selections.roadmap, sections.roadmapGad, selections.roadmapGad, userMap, driOverrides, dates, roadmapMonth));
    }
  }, [previewMode, sections, selections, userMap, driOverrides, dates, monthlyMetrics, roadmapMonth]);

  // Channel search
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

  // Send
  const handleSend = async () => {
    if (!selectedChannel || !message) return;
    setSending(true);
    setSendError(null);
    try {
      const body: Record<string, string> = { channelId: selectedChannel.id, message };
      if (threadTs.trim()) body.thread_ts = threadTs.trim();
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

  // --- Render ---

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading digest...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading digest</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const weeklySelected = selections.launched.size + selections.gad.size + selections.launching.size + selections.ending.size;
  const totalSelected = weeklySelected + selections.roadmap.size + selections.roadmapGad.size;
  const totalExps = Object.values(sections).reduce((n, s) => n + s.length, 0);

  if (totalExps === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg mb-2">No experiments for this digest period</p>
        <p className="text-sm">No experiments are starting, ending, or GA&apos;ing in the current or last week.</p>
      </div>
    );
  }

  // Section renderer
  const renderSection = (
    title: string,
    sectionKey: SectionKey,
    exps: DigestExperiment[],
    dateField: "experimentStartDate" | "experimentEndDate" | "gaLaunchDate" | "expectedLaunchStartDate",
    acvField: "estimatedAcv" | "actualAcv",
  ) => {
    const sel = selections[sectionKey];
    const allSelected = exps.length > 0 && exps.every((e) => sel.has(e.key));
    const total = sumAcv(exps.filter((e) => sel.has(e.key)), acvField);
    const acvLabel = acvField === "estimatedAcv" ? "Est." : "Actual";

    return (
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">
            {title} ({exps.length})
            <span className="text-gray-500 font-normal ml-2">
              Total {acvLabel} ACV: {formatAcv(total)}
            </span>
          </h3>
          {exps.length > 0 && (
            <button
              onClick={() => toggleAllInSection(sectionKey)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>
        {exps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400 italic">None</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {exps.map((exp) => (
              <label
                key={exp.key}
                className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  exp.experimentStatus === "Paused/Issues" || exp.experimentStatus === "Cancelled"
                    ? "bg-red-50"
                    : sel.has(exp.key) ? "bg-blue-50/50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={sel.has(exp.key)}
                  onChange={() => toggleSelect(sectionKey, exp.key)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={exp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {exp.key}
                    </a>
                    <span className="text-sm text-gray-900 truncate">{exp.summary}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                    <span>{exp[dateField] ? formatShortDate(exp[dateField]) : "'Unknown'"}</span>
                    <span>{acvLabel} ACV: {exp[acvField] !== null ? formatAcv(exp[acvField] || 0) : "'Unknown'"}</span>
                    <span className="inline-flex items-center gap-1">
                      {(() => {
                        const driName = driOverrides[exp.key] ?? exp.experimentDri[0]?.displayName ?? "";
                        const candidates = driName ? (candidateMap[driName] || []) : [];
                        const selected = driName ? userMap[driName] : null;

                        return (
                          <>
                            DRI:
                            {selected?.avatar && (
                              <img src={selected.avatar} alt={selected.displayName} className="w-4 h-4 rounded-full" />
                            )}
                            {candidates.length > 1 ? (
                              <select
                                value={selected?.slackId || ""}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  if (driName) selectSlackUser(driName, e.target.value);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="border border-gray-200 rounded px-1 py-0 text-xs bg-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none max-w-48"
                              >
                                <option value="">Select...</option>
                                {candidates.map((c) => (
                                  <option key={c.slackId} value={c.slackId}>
                                    {c.displayName}{c.title ? ` — ${c.title}` : ""}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={driName || "'Unknown'"}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setDriOverrides((prev) => ({ ...prev, [exp.key]: e.target.value }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Slack lookup name"
                                className="border border-gray-200 rounded px-1.5 py-0 text-xs w-32 bg-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                            )}
                          </>
                        );
                      })()}
                    </span>
                    <span>Category: {exp.productCategory || "'Unknown'"}</span>
                    <span>Squad: {exp.growthSquad || "'Unknown'"}</span>
                    <span className="text-gray-400">{exp.experimentStatus || "'Unknown'"}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Monthly metrics summary */}
      {dates && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            {getMonthName(dates.monthStart)} Metrics (Month-to-date)
          </h3>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{monthlyMetrics.velocity}</div>
              <div className="text-xs text-gray-500">Velocity</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{formatAcv(monthlyMetrics.estAcv)}</div>
              <div className="text-xs text-gray-500">Est. ACV Impact</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{monthlyMetrics.successRate}</div>
              <div className="text-xs text-gray-500">GA&apos;d</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{formatAcv(monthlyMetrics.actualAcv)}</div>
              <div className="text-xs text-gray-500">Actual ACV</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {totalExps} experiment{totalExps !== 1 ? "s" : ""} across digest sections
          {totalSelected > 0 && (
            <span className="ml-2 font-medium text-gray-900">&middot; {totalSelected} selected</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePreview("weekly")}
            disabled={weeklySelected === 0 || lookingUpUsers}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lookingUpUsers ? "Looking up users..." : `Preview Weekly Digest (${weeklySelected})`}
          </button>
          <button
            onClick={() => handlePreview("monthly")}
            disabled={(selections.roadmap.size + selections.roadmapGad.size) === 0 || lookingUpUsers}
            className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lookingUpUsers ? "Looking up users..." : `Preview Monthly Roadmap (${selections.roadmap.size + selections.roadmapGad.size})`}
          </button>
        </div>
      </div>

      {/* Sections */}
      {dates && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">
            Last Week: {formatDateRangeLong(dates.lastWeekStart, dates.lastWeekEnd)}
          </h2>
          {renderSection("Launched Last Week", "launched", sections.launched, "experimentStartDate", "estimatedAcv")}
          {renderSection("GA'd Last Week", "gad", sections.gad, "expectedLaunchStartDate", "actualAcv")}

          <h2 className="text-sm font-semibold text-gray-700 pt-2">
            This Week: {formatDateRangeLong(dates.thisWeekStart, dates.thisWeekEnd)}
          </h2>
          {renderSection("Planned Launches This Week", "launching", sections.launching, "experimentStartDate", "estimatedAcv")}
          {renderSection("Experiments Ending This Week", "ending", sections.ending, "experimentEndDate", "estimatedAcv")}

          <div className="flex items-center gap-3 pt-2">
            <h2 className="text-sm font-semibold text-gray-700">
              {roadmapMonth === "current" ? getMonthName(dates.monthStart) : getMonthName(dates.nextMonthStart)} Roadmap
            </h2>
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button
                onClick={() => setRoadmapMonth("current")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  roadmapMonth === "current"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {getMonthName(dates.monthStart)}
              </button>
              <button
                onClick={() => setRoadmapMonth("next")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  roadmapMonth === "next"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {getMonthName(dates.nextMonthStart)}
              </button>
            </div>
          </div>
          {renderSection(
            `All ${roadmapMonth === "current" ? getMonthName(dates.monthStart) : getMonthName(dates.nextMonthStart)} Experiments`,
            "roadmap",
            sections.roadmap,
            "experimentStartDate",
            "estimatedAcv",
          )}
          {renderSection(
            `${roadmapMonth === "current" ? getMonthName(dates.monthStart) : getMonthName(dates.nextMonthStart)} GA'd`,
            "roadmapGad",
            sections.roadmapGad,
            "expectedLaunchStartDate",
            "actualAcv",
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewMode && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {previewMode === "weekly" ? "Preview Weekly Digest" : "Preview Monthly Roadmap"}
                </h3>
                <p className="text-xs text-gray-500">
                  {previewMode === "weekly" ? weeklySelected : selections.roadmap.size} experiments selected
                </p>
              </div>
              <button
                onClick={() => setPreviewMode(null)}
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

              {/* Thread TS */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Thread <span className="text-gray-400 font-normal">(optional — paste a Slack URL or timestamp to reply in a thread)</span>
                </label>
                <input
                  type="text"
                  value={threadTs}
                  onChange={(e) => {
                    const val = e.target.value;
                    const tsMatch = val.match(/thread_ts=([0-9.]+)/);
                    if (tsMatch) {
                      setThreadTs(tsMatch[1]);
                    } else {
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

              {/* Message preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message preview</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={20}
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
                onClick={() => setPreviewMode(null)}
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

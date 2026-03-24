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
  lines.push(`_Dates shown are experiment start dates_`);
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
  lines.push(`_Dates shown are GA dates_`);
  for (const exp of gadFiltered) {
    const date = exp.expectedLaunchStartDate ? formatShortDate(exp.expectedLaunchStartDate) : "`Unknown`";
    const dri = getDriMention(exp);
    const acv = formatAcvOrUnknown(exp.actualAcv);
    lines.push(`    \u25e6 ${date}: <${exp.url}|${exp.summary}> | Actual ACV: ${acv} | DRI: ${dri}`);
  }

  return lines.join("\n");
}

// --- WoW Slack Message Builder ---

function buildWowSlackMessage(diff: {
  added: Array<{ key: string; summary: string; estimatedAcv: number | null; url?: string }>;
  dropped: Array<{ key: string; summary: string; estimatedAcv: number | null }>;
  acvChanges: Array<{ key: string; summary: string; oldAcv: number | null; newAcv: number | null }>;
  dateChanges: Array<{ key: string; summary: string; field: string; oldDate: string | null; newDate: string | null }>;
  snapshotDate: string;
}): string {
  const lines: string[] = [];
  const snapLabel = new Date(diff.snapshotDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  lines.push(`:bar_chart: *Experiment Roadmap — Week-over-Week Changes* (vs. ${snapLabel})`);
  lines.push("");

  if (diff.added.length > 0) {
    lines.push(`*:heavy_plus_sign: Added (${diff.added.length})*`);
    for (const e of diff.added) {
      const jiraUrl = (e as { url?: string }).url || `https://jira.tinyspeck.com/browse/${e.key}`;
      const acv = e.estimatedAcv ? ` | Est. ACV: ${formatAcv(e.estimatedAcv)}` : "";
      lines.push(`    • <${jiraUrl}|${e.key}> ${e.summary}${acv}`);
    }
    lines.push("");
  }

  if (diff.dropped.length > 0) {
    lines.push(`*:heavy_minus_sign: Dropped (${diff.dropped.length})*`);
    for (const e of diff.dropped) {
      const acv = e.estimatedAcv ? ` | Est. ACV: ${formatAcv(e.estimatedAcv)}` : "";
      lines.push(`    • <https://jira.tinyspeck.com/browse/${e.key}|${e.key}> ${e.summary}${acv}`);
    }
    lines.push("");
  }

  if (diff.acvChanges.length > 0) {
    lines.push(`*:chart_with_upwards_trend: ACV Adjustments (${diff.acvChanges.length})*`);
    for (const c of diff.acvChanges) {
      const oldVal = c.oldAcv !== null ? formatAcv(c.oldAcv) : "none";
      const newVal = c.newAcv !== null ? formatAcv(c.newAcv) : "none";
      lines.push(`    • <https://jira.tinyspeck.com/browse/${c.key}|${c.key}> ${c.summary}: ${oldVal} → ${newVal}`);
    }
    lines.push("");
  }

  if (diff.dateChanges.length > 0) {
    lines.push(`*:calendar: Date Changes (${diff.dateChanges.length})*`);
    for (const c of diff.dateChanges) {
      const label = c.field === "experimentStartDate" ? "Start" : "End";
      const oldVal = c.oldDate ? formatShortDate(c.oldDate) : "—";
      const newVal = c.newDate ? formatShortDate(c.newDate) : "—";
      lines.push(`    • <https://jira.tinyspeck.com/browse/${c.key}|${c.key}> ${c.summary} (${label}): ${oldVal} → ${newVal}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// --- Collision Types ---

interface CollisionExperiment {
  key: string;
  summary: string;
  url: string;
  experimentStatus: string;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  growthSquad: string | null;
  productCategory: string | null;
  dri: string | null;
}

interface CollisionMonth {
  start: string;
  end: string;
  label: string;
  offset: number;
}

// --- Component ---

export function ExperimentDigest() {
  const [experiments, setExperiments] = useState<DigestExperiment[]>([]);
  const [dates, setDates] = useState<DateRanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collision calendar state
  const [collisionExps, setCollisionExps] = useState<CollisionExperiment[]>([]);
  const [collisionsLoading, setCollisionsLoading] = useState(true);
  const [collisionsExpanded, setCollisionsExpanded] = useState(true);
  const [collisionMonth, setCollisionMonth] = useState(0);
  const [collisionMonthInfo, setCollisionMonthInfo] = useState<CollisionMonth | null>(null);
  const [collisionGroupBy, setCollisionGroupBy] = useState<"squad" | "category">("squad");

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

  // WoW snapshot state
  interface SnapshotExp {
    key: string;
    summary: string;
    estimatedAcv: number | null;
    experimentStartDate: string | null;
    experimentEndDate: string | null;
  }
  interface WowDiff {
    added: DigestExperiment[];
    dropped: SnapshotExp[];
    acvChanges: Array<{ key: string; summary: string; oldAcv: number | null; newAcv: number | null }>;
    dateChanges: Array<{
      key: string;
      summary: string;
      field: "experimentStartDate" | "experimentEndDate";
      oldDate: string | null;
      newDate: string | null;
    }>;
    snapshotDate: string;
  }
  const [wowDiff, setWowDiff] = useState<WowDiff | null>(null);
  const [wowExpanded, setWowExpanded] = useState(true);
  const [availableSnapshots, setAvailableSnapshots] = useState<string[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const snapshotSavedFor = useRef<string>("");

  // Slack user lookup
  const [candidateMap, setCandidateMap] = useState<Record<string, SlackCandidate[]>>({});
  const [userMap, setUserMap] = useState<Record<string, SlackUser | null>>({});
  const [lookingUpUsers, setLookingUpUsers] = useState(false);

  // Preview/send state — "weekly" or "monthly" or null
  const [previewMode, setPreviewMode] = useState<"weekly" | "monthly" | "wow" | null>(null);
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

  // Compute diff from a snapshot
  const computeDiff = useCallback((prev: { date: string; experiments: SnapshotExp[] }) => {
    const prevMap = new Map(prev.experiments.map((e) => [e.key, e]));
    const currMap = new Map(sections.roadmap.map((e) => [e.key, e]));

    const added = sections.roadmap.filter((e) => !prevMap.has(e.key));
    const dropped = prev.experiments.filter((e) => !currMap.has(e.key));

    const acvChanges: WowDiff["acvChanges"] = [];
    const dateChanges: WowDiff["dateChanges"] = [];

    for (const curr of sections.roadmap) {
      const old = prevMap.get(curr.key);
      if (!old) continue;
      if ((old.estimatedAcv ?? null) !== (curr.estimatedAcv ?? null)) {
        acvChanges.push({ key: curr.key, summary: curr.summary, oldAcv: old.estimatedAcv, newAcv: curr.estimatedAcv });
      }
      if ((old.experimentStartDate ?? null) !== (curr.experimentStartDate ?? null)) {
        dateChanges.push({ key: curr.key, summary: curr.summary, field: "experimentStartDate", oldDate: old.experimentStartDate, newDate: curr.experimentStartDate });
      }
      if ((old.experimentEndDate ?? null) !== (curr.experimentEndDate ?? null)) {
        dateChanges.push({ key: curr.key, summary: curr.summary, field: "experimentEndDate", oldDate: old.experimentEndDate, newDate: curr.experimentEndDate });
      }
    }

    setWowDiff({ added, dropped, acvChanges, dateChanges, snapshotDate: prev.date });
  }, [sections.roadmap]);

  // WoW diff: fetch previous snapshot, compute diff, save current snapshot
  useEffect(() => {
    if (sections.roadmap.length === 0 || !dates) return;

    const today = new Date().toISOString().split("T")[0];

    // Fetch default snapshot (most recent before today)
    fetch(`/api/experiment-digest/snapshots?month=${roadmapMonth}`)
      .then((r) => r.json())
      .then((data) => {
        setAvailableSnapshots(data.availableDates || []);

        const prev = data.snapshot as { date: string; experiments: SnapshotExp[] } | null;
        if (prev) {
          setSelectedSnapshot(prev.date);
          computeDiff(prev);
        } else {
          setWowDiff(null);
          setSelectedSnapshot(null);
        }

        // Save today's snapshot (once per month toggle per session)
        const saveKey = `${today}_${roadmapMonth}`;
        if (snapshotSavedFor.current !== saveKey) {
          snapshotSavedFor.current = saveKey;
          const monthLabel = getMonthName(roadmapMonth === "current" ? dates.monthStart : dates.nextMonthStart);
          fetch("/api/experiment-digest/snapshots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: today,
              month: roadmapMonth,
              monthLabel,
              experiments: sections.roadmap.map((e) => ({
                key: e.key,
                summary: e.summary,
                estimatedAcv: e.estimatedAcv,
                experimentStartDate: e.experimentStartDate,
                experimentEndDate: e.experimentEndDate,
              })),
            }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [sections.roadmap, dates, roadmapMonth, computeDiff]);

  // Re-fetch when user selects a different snapshot
  useEffect(() => {
    if (!selectedSnapshot || sections.roadmap.length === 0) return;

    fetch(`/api/experiment-digest/snapshots?month=${roadmapMonth}&date=${selectedSnapshot}`)
      .then((r) => r.json())
      .then((data) => {
        const prev = data.snapshot as { date: string; experiments: SnapshotExp[] } | null;
        if (prev) {
          computeDiff(prev);
        } else {
          setWowDiff(null);
        }
      })
      .catch(() => {});
    // Only re-run when selectedSnapshot changes manually, not on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSnapshot]);

  // Fetch collision calendar data (re-fetches when month changes)
  useEffect(() => {
    setCollisionsLoading(true);
    fetch(`/api/experiment-digest/collisions?month=${collisionMonth}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.experiments) setCollisionExps(data.experiments);
        if (data.month) setCollisionMonthInfo(data.month);
      })
      .catch(() => {})
      .finally(() => setCollisionsLoading(false));
  }, [collisionMonth]);

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

  // Slack user lookup — returns the resolved userMap so callers don't need to wait for React state
  const lookupUsers = useCallback(async (exps: DigestExperiment[]): Promise<Record<string, SlackUser | null>> => {
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
    if (toLookup.length === 0) return {};

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

      // Auto-select first candidate for each name
      const autoSelected: Record<string, SlackUser | null> = {};
      for (const [name, candidates] of Object.entries(newCandidates)) {
        if (candidates.length >= 1) {
          autoSelected[name] = candidates[0];
        }
      }
      if (Object.keys(autoSelected).length > 0) {
        setUserMap((prev) => ({ ...prev, ...autoSelected }));
      }
      return autoSelected;
    } catch {
      return {};
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

  const [driError, setDriError] = useState<string | null>(null);

  const handlePreview = async (mode: "weekly" | "monthly") => {
    const freshUsers = await lookupUsers(experiments);
    // Merge with existing userMap since lookupUsers returns only newly resolved
    const resolvedUsers = { ...userMap, ...freshUsers };
    setDriError(null);

    // Warn about unresolved DRIs but don't block preview
    const weeklySections: SectionKey[] = ["launched", "gad", "launching", "ending"];
    const monthlySections: SectionKey[] = ["roadmap", "roadmapGad"];
    const sectionsToCheck = mode === "weekly" ? weeklySections : monthlySections;

    const missing: string[] = [];
    for (const sKey of sectionsToCheck) {
      for (const exp of sections[sKey]) {
        if (!selections[sKey].has(exp.key)) continue;
        const driName = driOverrides[exp.key] ?? exp.experimentDri[0]?.displayName ?? "";
        if (!driName || !resolvedUsers[driName]) {
          missing.push(exp.key);
        }
      }
    }

    if (missing.length > 0) {
      setDriError(`${missing.length} experiment(s) without a resolved Slack DRI will show plain text names: ${missing.join(", ")}`);
    }

    setPreviewMode(mode);
    setSent(false);
    setSendError(null);
  };

  // Rebuild message when preview or inputs change
  useEffect(() => {
    if (!previewMode || !dates) return;
    if (previewMode === "weekly") {
      setMessage(buildSlackMessage(sections, selections, userMap, driOverrides, dates, monthlyMetrics));
    } else if (previewMode === "wow") {
      if (wowDiff) setMessage(buildWowSlackMessage(wowDiff));
    } else {
      setMessage(buildMonthlyMessage(sections.roadmap, selections.roadmap, sections.roadmapGad, selections.roadmapGad, userMap, driOverrides, dates, roadmapMonth));
    }
  }, [previewMode, sections, selections, userMap, driOverrides, dates, monthlyMetrics, roadmapMonth, wowDiff]);

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

  // --- Collision calendar computed values (must be before early returns) ---

  // Group collision experiments by squad or category for the calendar
  const collisionGroups = useMemo(() => {
    const groups = new Map<string, CollisionExperiment[]>();
    for (const exp of collisionExps) {
      const key = collisionGroupBy === "squad"
        ? (exp.growthSquad || "No Squad")
        : (exp.productCategory || "No Category");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(exp);
    }
    // Sort groups: those with 2+ experiments (potential overlaps) first
    return [...groups.entries()].sort((a, b) => {
      if (a[1].length > 1 && b[1].length <= 1) return -1;
      if (a[1].length <= 1 && b[1].length > 1) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [collisionExps, collisionGroupBy]);

  // Count groups with overlaps
  const overlapGroupCount = useMemo(() => {
    let count = 0;
    for (const [, exps] of collisionGroups) {
      if (exps.length < 2) continue;
      let found = false;
      for (let i = 0; i < exps.length && !found; i++) {
        for (let j = i + 1; j < exps.length && !found; j++) {
          const a = exps[i], b = exps[j];
          if (!a.experimentStartDate || !b.experimentStartDate) continue;
          const aEnd = a.experimentEndDate || a.experimentStartDate;
          const bEnd = b.experimentEndDate || b.experimentStartDate;
          const overlapStart = a.experimentStartDate > b.experimentStartDate ? a.experimentStartDate : b.experimentStartDate;
          const overlapEnd = aEnd < bEnd ? aEnd : bEnd;
          if (overlapStart <= overlapEnd) { count++; found = true; }
        }
      }
    }
    return count;
  }, [collisionGroups]);

  // Calendar helpers
  const calDaysInMonth = collisionMonthInfo
    ? Math.round((new Date(collisionMonthInfo.end + "T00:00:00").getTime() - new Date(collisionMonthInfo.start + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 30;

  const calStart = collisionMonthInfo?.start || "";
  const calEnd = collisionMonthInfo?.end || "";

  const calWeekMarkers = useMemo(() => {
    if (!calStart) return [];
    const markers: { pct: string; label: string; isMajor: boolean }[] = [];
    const cursor = new Date(calStart + "T00:00:00");
    const endDate = new Date(calEnd + "T00:00:00");
    while (cursor <= endDate) {
      const day = cursor.getDate();
      const isMonday = cursor.getDay() === 1;
      const isFirst = day === 1;
      if (isFirst || isMonday) {
        const offset = Math.round((cursor.getTime() - new Date(calStart + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
        markers.push({
          pct: `${(offset / calDaysInMonth) * 100}%`,
          label: isFirst
            ? cursor.toLocaleDateString("en-US", { month: "short" })
            : String(day),
          isMajor: isFirst,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return markers;
  }, [calStart, calEnd, calDaysInMonth]);

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

  // Collision calendar render helpers (not hooks — safe after early returns)
  function dayOffset(dateStr: string): number {
    if (!calStart) return 0;
    return Math.round((new Date(dateStr + "T00:00:00").getTime() - new Date(calStart + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
  }

  function barStyle(exp: CollisionExperiment): { left: string; width: string } {
    if (!exp.experimentStartDate) return { left: "0%", width: "0%" };
    const start = exp.experimentStartDate < calStart ? calStart : exp.experimentStartDate;
    const end = exp.experimentEndDate
      ? (exp.experimentEndDate > calEnd ? calEnd : exp.experimentEndDate)
      : start;
    const leftDay = dayOffset(start);
    const widthDays = Math.max(dayOffset(end) - leftDay + 1, 1);
    return {
      left: `${(leftDay / calDaysInMonth) * 100}%`,
      width: `${(widthDays / calDaysInMonth) * 100}%`,
    };
  }

  const BAR_COLORS = [
    "bg-blue-400", "bg-purple-400", "bg-emerald-400", "bg-amber-400",
    "bg-rose-400", "bg-cyan-400", "bg-indigo-400", "bg-orange-400",
    "bg-teal-400", "bg-pink-400",
  ];

  const todayStr = new Date().toISOString().split("T")[0];
  const todayInRange = calStart && calEnd && todayStr >= calStart && todayStr <= calEnd;
  const todayPct = todayInRange ? `${(dayOffset(todayStr) / calDaysInMonth) * 100}%` : null;

  return (
    <div className="space-y-4">
      {/* Experiment Collision Calendar */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between rounded-t-lg">
          <button
            onClick={() => setCollisionsExpanded(!collisionsExpanded)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h3 className="text-sm font-semibold text-gray-900">
              Experiment Calendar
            </h3>
            {!collisionsLoading && (
              <span className="text-xs text-gray-500">
                {collisionExps.length} experiments
                {overlapGroupCount > 0 && (
                  <span className="text-orange-600 font-medium ml-1">
                    ({overlapGroupCount} {collisionGroupBy}{overlapGroupCount !== 1 ? "s" : ""} with overlaps)
                  </span>
                )}
              </span>
            )}
            <span className="text-gray-400 text-xs ml-2">{collisionsExpanded ? "collapse" : "expand"}</span>
          </button>
          <div className="flex items-center gap-3">
            {/* Group by toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5">
              {(["squad", "category"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setCollisionGroupBy(g)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    collisionGroupBy === g
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {g === "squad" ? "By Squad" : "By Category"}
                </button>
              ))}
            </div>
            {/* Month nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCollisionMonth((m) => m - 1)}
                disabled={collisionMonth <= 0}
                className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              >
                &larr;
              </button>
              <span className="text-xs font-medium text-gray-900 min-w-[120px] text-center">
                {collisionsLoading ? "..." : collisionMonthInfo?.label || ""}
              </span>
              <button
                onClick={() => setCollisionMonth((m) => m + 1)}
                disabled={collisionMonth >= 3}
                className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              >
                &rarr;
              </button>
            </div>
          </div>
        </div>

        {collisionsExpanded && (
          <div>
            {collisionsLoading ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">Loading experiment calendar...</div>
            ) : collisionExps.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">
                No active experiments for {collisionMonthInfo?.label || "this month"}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* Day headers */}
                <div className="flex border-b border-gray-100">
                  <div className="shrink-0 w-[200px] border-r border-gray-100" />
                  <div className="relative flex-1 h-6 min-w-[600px]">
                    {calWeekMarkers.map((m, i) => (
                      <span
                        key={i}
                        className={`absolute top-0 text-[10px] pl-0.5 ${m.isMajor ? "font-semibold text-gray-600" : "text-gray-400"}`}
                        style={{ left: m.pct }}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Grouped swim lanes */}
                {collisionGroups.map(([groupName, exps]) => {
                  const hasOverlap = exps.length >= 2;
                  return (
                    <div key={groupName} className="border-b border-gray-100">
                      {/* Group header */}
                      <div className={`flex ${hasOverlap ? "bg-orange-50/40" : ""}`}>
                        <div className="shrink-0 w-[200px] px-3 py-1.5 border-r border-gray-100 flex items-center">
                          <span className={`text-xs font-medium truncate ${hasOverlap ? "text-orange-800" : "text-gray-700"}`}>
                            {groupName}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-1.5">({exps.length})</span>
                        </div>
                        <div className="relative flex-1 min-w-[600px]" style={{ height: exps.length * 26 + 8 }}>
                          {/* Grid lines */}
                          {calWeekMarkers.map((m, i) => (
                            <div
                              key={i}
                              className="absolute top-0 bottom-0"
                              style={{
                                left: m.pct,
                                width: 1,
                                backgroundColor: m.isMajor ? "#e5e7eb" : "#f3f4f6",
                              }}
                            />
                          ))}
                          {/* Today line */}
                          {todayPct && (
                            <div
                              className="absolute top-0 bottom-0 z-10"
                              style={{ left: todayPct, width: 2, backgroundColor: "#ef4444" }}
                            />
                          )}
                          {/* Experiment bars */}
                          {exps.map((exp, idx) => {
                            const style = barStyle(exp);
                            const color = BAR_COLORS[idx % BAR_COLORS.length];
                            return (
                              <a
                                key={exp.key}
                                href={exp.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`absolute ${color} rounded h-[20px] opacity-80 hover:opacity-100 transition-opacity flex items-center overflow-hidden group`}
                                style={{
                                  left: style.left,
                                  width: style.width,
                                  top: idx * 26 + 4,
                                }}
                                title={`${exp.key}: ${exp.summary}\n${exp.experimentStartDate || "?"} - ${exp.experimentEndDate || "?"}\nStatus: ${exp.experimentStatus}\nDRI: ${exp.dri || "Unknown"}`}
                              >
                                <span className="text-[10px] text-white font-medium px-1.5 truncate drop-shadow-sm">
                                  {exp.key}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Legend */}
                <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 text-[10px] text-gray-500">
                  <div className="flex items-center gap-1">
                    <div className="w-0.5 h-3 bg-red-500" />
                    <span>Today</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-6 h-2.5 rounded bg-orange-50 border border-orange-200" />
                    <span>Groups with overlapping experiments</span>
                  </div>
                  <span className="ml-auto">Hover bars for details. Click to open in JIRA.</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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

      {driError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-800 text-sm">
          {driError}
        </div>
      )}

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

          {/* Week-over-Week Changes */}
          {wowDiff && (wowDiff.added.length > 0 || wowDiff.dropped.length > 0 || wowDiff.acvChanges.length > 0 || wowDiff.dateChanges.length > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <button
                  onClick={() => setWowExpanded((v) => !v)}
                  className="flex items-center gap-2 text-left"
                >
                  <span className="text-sm font-semibold text-amber-800">
                    Week-over-Week Changes
                  </span>
                  <span className="text-amber-600 text-xs">{wowExpanded ? "Hide" : "Show"}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-600">vs.</span>
                  <select
                    value={selectedSnapshot || ""}
                    onChange={(e) => setSelectedSnapshot(e.target.value)}
                    className="text-xs border border-amber-300 rounded px-1.5 py-0.5 bg-white text-amber-800 cursor-pointer"
                  >
                    {availableSnapshots.map((d) => (
                      <option key={d} value={d}>
                        {new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setSent(false);
                      setSendError(null);
                      setPreviewMode("wow");
                    }}
                    className="text-xs px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                  >
                    Share to Slack
                  </button>
                </div>
              </div>
              {wowExpanded && (
                <div className="px-4 pb-3 space-y-3">
                  {wowDiff.added.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-green-700 mb-1">+ Added ({wowDiff.added.length})</h4>
                      <ul className="space-y-0.5">
                        {wowDiff.added.map((e) => (
                          <li key={e.key} className="text-xs text-gray-700">
                            <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{e.key}</a>{" "}
                            {e.summary}
                            {e.estimatedAcv ? ` | Est. ACV: ${formatAcv(e.estimatedAcv)}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {wowDiff.dropped.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-red-700 mb-1">- Dropped ({wowDiff.dropped.length})</h4>
                      <ul className="space-y-0.5">
                        {wowDiff.dropped.map((e) => (
                          <li key={e.key} className="text-xs text-gray-700">
                            <a href={`https://jira.tinyspeck.com/browse/${e.key}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{e.key}</a>{" "}
                            {e.summary}
                            {e.estimatedAcv ? ` | Est. ACV: ${formatAcv(e.estimatedAcv)}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {wowDiff.acvChanges.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-purple-700 mb-1">ACV Adjustments ({wowDiff.acvChanges.length})</h4>
                      <ul className="space-y-0.5">
                        {wowDiff.acvChanges.map((c) => (
                          <li key={c.key} className="text-xs text-gray-700">
                            <a href={`https://jira.tinyspeck.com/browse/${c.key}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.key}</a>{" "}
                            {c.summary}: {c.oldAcv !== null ? formatAcv(c.oldAcv) : "none"} &rarr; {c.newAcv !== null ? formatAcv(c.newAcv) : "none"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {wowDiff.dateChanges.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-blue-700 mb-1">Date Changes ({wowDiff.dateChanges.length})</h4>
                      <ul className="space-y-0.5">
                        {wowDiff.dateChanges.map((c, i) => (
                          <li key={`${c.key}-${c.field}-${i}`} className="text-xs text-gray-700">
                            <a href={`https://jira.tinyspeck.com/browse/${c.key}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.key}</a>{" "}
                            {c.summary} ({c.field === "experimentStartDate" ? "Start" : "End"}): {formatShortDate(c.oldDate)} &rarr; {formatShortDate(c.newDate)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
                  {previewMode === "weekly" ? "Preview Weekly Digest" : previewMode === "wow" ? "Share WoW Changes" : "Preview Monthly Roadmap"}
                </h3>
                <p className="text-xs text-gray-500">
                  {previewMode === "wow"
                    ? `${(wowDiff?.added.length || 0) + (wowDiff?.dropped.length || 0) + (wowDiff?.acvChanges.length || 0) + (wowDiff?.dateChanges.length || 0)} changes`
                    : previewMode === "weekly" ? `${weeklySelected} experiments selected` : `${selections.roadmap.size} experiments selected`}
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

"use client";

import type { HoustonExperimentInfo } from "@/lib/types";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  finished: "bg-purple-100 text-purple-700",
  archived: "bg-gray-100 text-gray-500",
};

const directionIcons: Record<string, string> = {
  positive: "↑",
  negative: "↓",
  neutral: "–",
};

export function ExperimentSection({ experiments }: { experiments: HoustonExperimentInfo[] }) {
  if (experiments.length === 0) return null;

  return (
    <div className="mb-3">
      <h4 className="text-xs font-medium text-gray-500 mb-1.5">Houston Experiments</h4>
      <div className="space-y-2">
        {experiments.map((exp) => (
          <ExperimentCard key={exp.id} experiment={exp} />
        ))}
      </div>
    </div>
  );
}

function ExperimentCard({ experiment: exp }: { experiment: HoustonExperimentInfo }) {
  const isRunning = exp.status === "active" || exp.status === "finished";

  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[exp.status] || statusColors.draft}`}>
          {exp.status}
        </span>
        <span className="text-[10px] text-gray-400 uppercase">
          {exp.toggleType === "experiment" ? "A/B" : "release"}
        </span>
        <span className="font-mono text-xs text-gray-700 truncate" title={exp.name}>
          {exp.name}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto shrink-0">
          by {exp.owner}
        </span>
      </div>

      {/* Summary */}
      {exp.summary && (
        <p className="text-xs text-gray-600 mb-1 line-clamp-2">{exp.summary}</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        {/* Rollout */}
        {exp.rolloutPercent !== null && (
          <div className="flex items-center gap-1">
            <span>Rollout:</span>
            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${Math.min(exp.rolloutPercent, 100)}%` }}
              />
            </div>
            <span className="font-medium">{exp.rolloutPercent}%</span>
          </div>
        )}

        {/* Exposures */}
        {exp.exposureCount !== undefined && exp.exposureCount > 0 && (
          <span>{exp.exposureCount.toLocaleString()} exposures</span>
        )}

        {/* SRM alert */}
        {exp.srmIssue && (
          <span className="text-red-600 font-medium">SRM issue detected</span>
        )}

        {/* No metrics warning */}
        {isRunning && exp.hasMetrics === false && (
          <span className="text-yellow-600">No metrics configured</span>
        )}

        {/* Stuck in draft */}
        {exp.status === "draft" && (
          <span className="text-yellow-600">No rollout scheduled</span>
        )}
      </div>

      {/* Metric results */}
      {exp.metrics && exp.metrics.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {exp.metrics.map((m, i) => (
              <div
                key={i}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                  m.isSignificant && m.direction === "positive"
                    ? "bg-green-50 text-green-700"
                    : m.isSignificant && m.direction === "negative"
                      ? "bg-red-50 text-red-700"
                      : "bg-gray-100 text-gray-600"
                }`}
                title={`p=${m.pValue?.toFixed(4) ?? "?"}, effect=${m.effectSize?.toFixed(4) ?? "?"}`}
              >
                <span className="font-medium">{directionIcons[m.direction]}</span>
                <span className="truncate max-w-[120px]">{m.metricName}</span>
                {m.effectSize !== null && (
                  <span className="font-mono">
                    {m.effectSize > 0 ? "+" : ""}{(m.effectSize * 100).toFixed(1)}%
                  </span>
                )}
                {m.isSignificant && <span className="font-bold">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

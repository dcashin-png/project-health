"use client";

import type { ProjectHealth } from "@/lib/types";
import { HealthBadge, StatusBadge } from "./StatusBadge";
import { ExperimentSection } from "./ExperimentBadge";
import { ShareToSlackButton } from "./ShareToSlack";

export function ProjectCard({ data }: { data: ProjectHealth }) {
  const { project, health, risks, issues, needsLeadership, summary, qualitativeHealth, experiments } = data;

  return (
    <div
      className={`rounded-lg border p-4 shadow-sm ${
        needsLeadership ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {project.url ? (
              <a href={project.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {project.name}
              </a>
            ) : (
              project.name
            )}
            <span className="ml-2 text-sm font-normal text-gray-500">{project.key}</span>
          </h3>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {project.jiraProject && <span>{project.jiraProject}</span>}
            {project.jiraProject && project.lead && <span>·</span>}
            {project.lead && <span>{project.lead}</span>}
            {project.slackChannel && (
              <>
                <span>·</span>
                <span className="text-blue-600">{project.slackChannel}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareToSlackButton data={data} />
          {project.status && <StatusBadge label={project.status} />}
          <HealthBadge status={health} />
        </div>
      </div>

      {summary && <p className="text-sm text-gray-700 mb-3">{summary}</p>}

      {needsLeadership && (
        <div className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800 font-medium">
          Needs leadership attention
        </div>
      )}

      {/* Qualitative health from Slack */}
      {qualitativeHealth && (
        <div className={`mb-3 rounded px-3 py-2 text-sm ${
          qualitativeHealth.channelMissing
            ? "bg-yellow-50 border border-yellow-200 text-yellow-800"
            : qualitativeHealth.signals.some((s) => s.includes("Blocker") || s.includes("Timeline") || s.includes("Escalation"))
              ? "bg-orange-50 border border-orange-200 text-orange-800"
              : qualitativeHealth.signals.some((s) => s.includes("Positive"))
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-gray-50 border border-gray-200 text-gray-700"
        }`}>
          <p className="font-medium mb-1">{qualitativeHealth.summary}</p>
          {qualitativeHealth.signals.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {qualitativeHealth.signals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Houston Experiments */}
      {experiments && experiments.length > 0 && (
        <ExperimentSection experiments={experiments} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        {risks.length > 0 && (
          <div>
            <h4 className="font-medium text-red-700 mb-1">Risks</h4>
            <ul className="list-disc list-inside text-gray-600">
              {risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {issues.length > 0 && (
          <div>
            <h4 className="font-medium text-yellow-700 mb-1">Issues</h4>
            <ul className="list-disc list-inside text-gray-600">
              {issues.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

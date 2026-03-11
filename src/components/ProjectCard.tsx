"use client";

import type { ProjectHealth } from "@/lib/types";
import { HealthBadge, StatusBadge } from "./StatusBadge";

export function ProjectCard({ data }: { data: ProjectHealth }) {
  const { project, phase, health, risks, decisions, issues, needsLeadership, summary } = data;

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
          </div>
        </div>
        <div className="flex items-center gap-2">
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
        {decisions.length > 0 && (
          <div>
            <h4 className="font-medium text-blue-700 mb-1">Decisions</h4>
            <ul className="list-disc list-inside text-gray-600">
              {decisions.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

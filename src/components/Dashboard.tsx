"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectHealth } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";
import { FilterPicker } from "./FilterPicker";

type HealthFilter = "all" | "needs-help" | "at-risk" | "healthy";

const FILTER_STORAGE_KEY = "project-health-jira-filter";

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectHealth[]>([]);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [jiraFilter, setJiraFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(FILTER_STORAGE_KEY) || "";
    }
    return "";
  });

  useEffect(() => {
    fetch("/api/health-check")
      .then((r) => r.json())
      .then((data) => setConnectedServers(data.configuredServers || []))
      .catch(() => {});
  }, []);

  const loadHealth = useCallback((filter: string) => {
    setLoading(true);
    setError(null);
    const url = filter
      ? `/api/health?filter=${encodeURIComponent(filter)}`
      : "/api/health";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setProjects(data.projects || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadHealth(jiraFilter);
  }, [jiraFilter, loadHealth]);

  const handleFilterChange = (filter: string) => {
    setJiraFilter(filter);
    if (typeof window !== "undefined") {
      if (filter) {
        localStorage.setItem(FILTER_STORAGE_KEY, filter);
      } else {
        localStorage.removeItem(FILTER_STORAGE_KEY);
      }
    }
  };

  const filtered =
    healthFilter === "all"
      ? projects
      : healthFilter === "needs-help"
        ? projects.filter((p) => p.needsLeadership)
        : projects.filter((p) => p.health === healthFilter);

  const counts = {
    all: projects.length,
    healthy: projects.filter((p) => p.health === "healthy").length,
    "at-risk": projects.filter((p) => p.health === "at-risk").length,
    "needs-help": projects.filter((p) => p.needsLeadership).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Project Health Dashboard</h1>
          <div className="flex items-center gap-3">
            {connectedServers.includes("slack") ? (
              <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">Slack connected</span>
            ) : (
              <a
                href="/api/auth/slack"
                className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
              >
                Connect Slack
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* JIRA Filter picker */}
        <FilterPicker
          currentFilter={jiraFilter}
          onFilterChange={handleFilterChange}
        />

        {/* Health filter tabs */}
        <div className="flex gap-2 mb-6">
          {(["all", "needs-help", "at-risk", "healthy"] as HealthFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setHealthFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                healthFilter === f
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {f === "all" ? "All" : f === "needs-help" ? "Needs Help" : f === "at-risk" ? "At Risk" : "Healthy"}
              <span className="ml-1.5 text-xs opacity-75">({counts[f]})</span>
            </button>
          ))}
        </div>

        {/* Content */}
        {!jiraFilter && !loading && (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">Select a JIRA filter to get started</p>
            <p className="text-sm">Each epic in the filter will appear as a project with health analysis based on its child issues.</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-500">Loading epics...</div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
            <h3 className="font-medium mb-1">Error loading epics</h3>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {jiraFilter && !loading && !error && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {projects.length === 0
              ? `No epics found for filter "${jiraFilter}". Try a different JIRA filter.`
              : "No epics match the current health filter."}
          </div>
        )}

        <div className="space-y-4">
          {filtered.map((p) => (
            <ProjectCard key={p.project.key} data={p} />
          ))}
        </div>
      </main>
    </div>
  );
}

import type { HealthStatus, Phase } from "@/lib/types";

const healthColors: Record<HealthStatus, string> = {
  healthy: "bg-green-100 text-green-800",
  "at-risk": "bg-yellow-100 text-yellow-800",
  "needs-help": "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-800",
};

const phaseColors: Record<Phase, string> = {
  planning: "bg-blue-100 text-blue-800",
  "in-progress": "bg-purple-100 text-purple-800",
  review: "bg-indigo-100 text-indigo-800",
  launched: "bg-green-100 text-green-800",
  unknown: "bg-gray-100 text-gray-800",
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${healthColors[status]}`}
    >
      {status}
    </span>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${phaseColors[phase]}`}
    >
      {phase}
    </span>
  );
}

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  development: "bg-purple-100 text-purple-800",
  "in review": "bg-indigo-100 text-indigo-800",
  "in progress": "bg-purple-100 text-purple-800",
  launched: "bg-green-100 text-green-800",
  shipping: "bg-green-100 text-green-800",
  "paused/issues": "bg-yellow-100 text-yellow-800",
  cancelled: "bg-gray-100 text-gray-800",
  triage: "bg-gray-100 text-gray-600",
  open: "bg-gray-100 text-gray-600",
};

export function StatusBadge({ label }: { label: string }) {
  const color = statusColors[label.toLowerCase()] || "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

import Papa from "papaparse";

// Parse CSV text into headers and rows
export function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`);
  }

  const [headers, ...rows] = result.data;
  return { headers: headers || [], rows };
}

// Jira fields available for mapping
export const MAPPABLE_FIELDS: Array<{
  id: string;
  label: string;
  type: "string" | "date" | "select" | "user" | "number" | "labels" | "multiuser";
  required?: boolean;
}> = [
  { id: "summary", label: "Summary", type: "string", required: true },
  { id: "description", label: "Description", type: "string" },
  { id: "priority", label: "Priority", type: "select" },
  { id: "labels", label: "Labels", type: "labels" },
  { id: "customfield_19103", label: "Experiment Status", type: "select" },
  { id: "customfield_18803", label: "Experiment Start Date", type: "date" },
  { id: "customfield_14505", label: "Experiment End Date", type: "date" },
  { id: "customfield_10611", label: "Expected Launch Start Date", type: "date" },
  { id: "customfield_18401", label: "Growth Squad", type: "select" },
  { id: "customfield_18500", label: "Experiment DRI", type: "multiuser" },
  { id: "customfield_10606", label: "Product Manager", type: "user" },
  { id: "customfield_19001", label: "Estimated ACV", type: "number" },
  { id: "customfield_19000", label: "Actual ACV", type: "number" },
  { id: "customfield_18506", label: "Primary Experiment Metric", type: "select" },
  { id: "customfield_18404", label: "Exposure Type", type: "select" },
  { id: "customfield_18403", label: "Funnel Stage", type: "select" },
  { id: "customfield_18407", label: "Experiment Goal", type: "select" },
  { id: "customfield_18408", label: "Exp Client Platform", type: "select" },
  { id: "customfield_10607", label: "Channel", type: "string" },
  { id: "customfield_10019", label: "Epic Name", type: "string" },
];

// Auto-suggest a Jira field for a column header
export function suggestMapping(header: string): string | null {
  const h = header.toLowerCase().trim();

  // Direct/keyword matches
  const rules: Array<{ keywords: string[]; fieldId: string }> = [
    { keywords: ["summary", "title", "name", "experiment name", "epic name"], fieldId: "summary" },
    { keywords: ["description", "desc", "details"], fieldId: "description" },
    { keywords: ["priority"], fieldId: "priority" },
    { keywords: ["label", "labels", "tag", "tags"], fieldId: "labels" },
    { keywords: ["experiment status", "exp status"], fieldId: "customfield_19103" },
    { keywords: ["experiment start", "exp start", "start date"], fieldId: "customfield_18803" },
    { keywords: ["experiment end", "exp end", "end date"], fieldId: "customfield_14505" },
    { keywords: ["launch date", "launch start", "expected launch"], fieldId: "customfield_10611" },
    { keywords: ["growth squad", "squad"], fieldId: "customfield_18401" },
    { keywords: ["experiment dri", "dri"], fieldId: "customfield_18500" },
    { keywords: ["product manager", "pm"], fieldId: "customfield_10606" },
    { keywords: ["estimated acv", "est acv", "est. acv"], fieldId: "customfield_19001" },
    { keywords: ["actual acv"], fieldId: "customfield_19000" },
    { keywords: ["primary metric", "experiment metric"], fieldId: "customfield_18506" },
    { keywords: ["exposure type", "exposure"], fieldId: "customfield_18404" },
    { keywords: ["funnel stage", "funnel"], fieldId: "customfield_18403" },
    { keywords: ["experiment goal", "goal"], fieldId: "customfield_18407" },
    { keywords: ["client platform", "platform"], fieldId: "customfield_18408" },
    { keywords: ["channel", "slack channel"], fieldId: "customfield_10607" },
  ];

  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (h === kw || h.includes(kw)) return rule.fieldId;
    }
  }

  // Fuzzy: check if the header is a substring of any field label or vice versa
  for (const field of MAPPABLE_FIELDS) {
    const fl = field.label.toLowerCase();
    if (fl.includes(h) || h.includes(fl)) return field.id;
  }

  return null;
}

// Convert a cell value to the appropriate Jira field format
export function formatFieldValue(
  value: string,
  fieldId: string,
  fieldType: string,
): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;

  switch (fieldType) {
    case "string":
      return trimmed;
    case "date":
      // Try to parse and format as YYYY-MM-DD
      try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split("T")[0];
        }
      } catch { /* fall through */ }
      return trimmed;
    case "select":
      return { value: trimmed };
    case "user":
      return { name: trimmed };
    case "multiuser":
      return trimmed.split(",").map((n) => ({ name: n.trim() })).filter((u) => u.name);
    case "number": {
      const num = parseFloat(trimmed.replace(/[,$]/g, ""));
      return isNaN(num) ? null : num;
    }
    case "labels":
      return trimmed.split(",").map((l) => l.trim()).filter(Boolean);
    default:
      return trimmed;
  }
}

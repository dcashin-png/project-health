#!/usr/bin/env node
/**
 * Fetches Growth Funnel data from Google Sheets via Apps Script.
 * Run: node scripts/fetch-funnel.mjs
 *
 * Opens the Apps Script URL in your browser (which has your Google session).
 * The browser will display raw JSON. Select all (Cmd+A), copy (Cmd+C),
 * then come back to the terminal and press Enter to save.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const APPS_SCRIPT_URL =
  "https://script.google.com/a/macros/salesforce.com/s/AKfycbzIZvIRLuDIjwheGlwbNewOxbmUo7n1Qm1JJR1RwfkUn8GTtJpPsLy48TTOOrXG_vVNDg/exec";
const DATA_DIR = path.join(process.cwd(), "data");
const OUTPUT_FILE = path.join(DATA_DIR, "funnel-data.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log("Opening Apps Script URL in your browser...");
console.log("The page will show raw JSON.\n");
execSync(`open "${APPS_SCRIPT_URL}"`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Copy the JSON (Cmd+A, Cmd+C), then press Enter here... ", () => {
  rl.close();

  try {
    const clipboard = execSync("pbpaste", { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
    const data = JSON.parse(clipboard);
    data._fetchedAt = new Date().toISOString();

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`\nSaved ${data.metrics?.length || 0} metrics to ${OUTPUT_FILE}`);
    console.log(`Data as of: ${data.asOf || "unknown"}`);
  } catch (err) {
    console.error("\nFailed to parse clipboard contents as JSON.");
    console.error("Make sure you copied the full JSON from the browser page.");
    console.error("Error:", err.message);
    process.exit(1);
  }
});

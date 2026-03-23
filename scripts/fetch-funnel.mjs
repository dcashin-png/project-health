#!/usr/bin/env node
/**
 * Fetches Growth Funnel data from Google Sheets via Apps Script.
 * Run: node scripts/fetch-funnel.mjs
 *
 * Opens a browser page that uses your existing Google session to fetch
 * the Apps Script endpoint, then saves the result to data/funnel-data.json.
 */

import http from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APPS_SCRIPT_URL =
  "https://script.google.com/a/macros/salesforce.com/s/AKfycbzIZvIRLuDIjwheGlwbNewOxbmUo7n1Qm1JJR1RwfkUn8GTtJpPsLy48TTOOrXG_vVNDg/exec";
const PORT = 3119;
const DATA_DIR = path.join(process.cwd(), "data");
const OUTPUT_FILE = path.join(DATA_DIR, "funnel-data.json");

// HTML page that fetches the Apps Script URL using the browser's Google session
const HTML = `<!DOCTYPE html>
<html>
<head><title>Fetching Funnel Data...</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb;">
  <div id="status" style="text-align: center;">
    <h2>Fetching funnel data...</h2>
    <p style="color: #6b7280;">Connecting to Google Sheets via Apps Script</p>
  </div>
  <script>
    async function run() {
      const status = document.getElementById('status');
      try {
        const res = await fetch('${APPS_SCRIPT_URL}', { credentials: 'include', redirect: 'follow' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();

        // If we got HTML back, the user needs to authenticate
        if (contentType.includes('text/html') || text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
          status.innerHTML = '<h2 style="color: #b91c1c;">Authentication required</h2>' +
            '<p>Opening Apps Script URL for authentication...</p>' +
            '<p style="font-size: 14px; color: #6b7280;">After signing in, come back here and the page will retry automatically.</p>';
          window.open('${APPS_SCRIPT_URL}', '_blank');
          // Retry after a delay
          setTimeout(run, 5000);
          return;
        }

        // Validate it's JSON
        const data = JSON.parse(text);

        // Send to our local server
        const saveRes = await fetch('http://localhost:${PORT}/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (saveRes.ok) {
          status.innerHTML = '<h2 style="color: #059669;">Done!</h2>' +
            '<p>Funnel data saved. You can close this tab.</p>' +
            '<p style="font-size: 14px; color: #6b7280;">Saved ' + (data.metrics?.length || 0) + ' metrics.</p>';
        } else {
          throw new Error('Failed to save data');
        }
      } catch (err) {
        status.innerHTML = '<h2 style="color: #b91c1c;">Error</h2>' +
          '<p>' + err.message + '</p>' +
          '<p style="font-size: 14px; color: #6b7280;">Check the terminal for details.</p>';
      }
    }
    run();
  </script>
</body>
</html>`;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        data._fetchedAt = new Date().toISOString();
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
        console.log(`\nSaved ${data.metrics?.length || 0} metrics to ${OUTPUT_FILE}`);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ ok: true }));
        // Shut down after a short delay
        setTimeout(() => {
          console.log("Done! You can close the browser tab.");
          process.exit(0);
        }, 500);
      } catch (err) {
        console.error("Failed to save:", err.message);
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log("Opening browser...\n");
  execSync(`open http://localhost:${PORT}`);
});

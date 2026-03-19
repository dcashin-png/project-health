# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Health Dashboard — a Next.js web app that provides leadership visibility into experiment health, project timelines, and cross-functional metrics. Connects to JIRA, Slack, and Google Sheets via MCP servers and direct APIs.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — run ESLint

## Architecture

```
src/
  app/
    page.tsx                          — renders the Dashboard component
    api/
      health/route.ts                 — project health from JIRA filter epics
      experiment-digest/route.ts      — weekly/monthly experiment digest data
      experiment-digest/collisions/route.ts — experiment collision calendar data
      experiment-cleanup/route.ts     — stale experiments needing cleanup
      experiment-cleanup/update/route.ts — bulk-update experiment status in JIRA
      acv/data/route.ts               — ACV metrics from ATS SQL queries
      acv/filters/route.ts            — ACV filter options
      jira-explore/route.ts           — ad-hoc JIRA queries with preset options
      stripe-tax/route.ts             — Stripe Tax project status from Slack channels
      stripe-tax/snapshots/route.ts   — historical daily snapshots
      roadmap/read/route.ts           — Google Sheets roadmap reader
      roadmap/diff/route.ts           — roadmap diff detection
      roadmap/sync/route.ts           — sync roadmap to JIRA
      slack/send/route.ts             — send Slack messages
      slack/channels/route.ts         — search Slack channels
      slack/lookup-users/route.ts     — resolve JIRA DRI names to Slack users
      filters/route.ts                — JIRA saved filter lookup
  components/
    Dashboard.tsx          — main shell with tab navigation
    ExperimentDigest.tsx   — weekly/monthly digest builder with collision calendar
    ExperimentCleanup.tsx  — stale experiment management
    AcvDashboard.tsx       — ACV tracking and charts
    JiraExplore.tsx        — ad-hoc JIRA query explorer
    StripeTaxDashboard.tsx — Stripe Tax project monitoring (RAID, timeline, workstreams)
    RoadmapSync.tsx        — Google Sheets to JIRA roadmap sync
    GanttChart.tsx         — timeline Gantt view for epics
    ProjectCard.tsx        — per-project health card
    ShareToSlack.tsx       — share dashboard views to Slack
    FilterPicker.tsx       — JIRA filter selector
    StatusBadge.tsx        — health/phase badge components
  lib/
    jira-api.ts            — JIRA REST API via slack-uberproxy-curl
    slack-api.ts           — Slack MCP client (HTTP JSON-RPC) with token auto-refresh
    slack-oauth.ts         — Slack OAuth helpers
    mcp-client.ts          — generic MCP client (stdio transport)
    sheets.ts              — Google Sheets API
    houston-api.ts         — Houston API (not yet configured)
    types.ts               — shared TypeScript types
    stripe-tax-types.ts    — Stripe Tax specific types
    ats-api.ts             — ATS analytics SQL query API
```

## Key JIRA Custom Fields

These are used across experiment-digest, cleanup, and collision APIs:

- `customfield_19103` — Experiment Status
- `customfield_18803` — Experiment Start Date
- `customfield_14505` — Experiment End Date
- `customfield_18500` — Experiment DRI (array of user objects)
- `customfield_18401` — Growth Squad
- `customfield_18801` — Product Category
- `customfield_19001` — Estimated ACV
- `customfield_19000` — Actual ACV
- `customfield_18503` — GA Launch Date
- `customfield_10611` — Expected Launch Start Date

## Key Patterns

- API routes bridge the React frontend and external services — the browser never talks to MCP/JIRA directly
- `callSlackMcp(toolName, args)` in `slack-api.ts` calls the Slack MCP server over HTTP; auto-refreshes expired tokens using the stored refresh_token
- `searchAllIssues(jql, fields)` in `jira-api.ts` handles JIRA pagination automatically
- Slack user lookup: JIRA DRI names are resolved to Slack user IDs via `/api/slack/lookup-users`. The lookup tries email first, falls back to name search. Results are auto-selected (first match).
- Stripe Tax snapshots are saved as daily JSON files in `data/stripe-tax-snapshots/` (gitignored)

## Slack Token Management

Tokens are stored in `.slack-tokens.json` (gitignored). If expired, `slack-api.ts` auto-refreshes using the refresh_token. If refresh fails, run `node scripts/slack-auth.mjs` to re-authorize via browser OAuth flow.

## Known Issues

- Pre-existing type error in `src/lib/ats-api.ts:46` — `AtsColumn[]` vs `string[]` mismatch. Does not affect runtime.

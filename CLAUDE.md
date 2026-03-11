# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Health Dashboard — a Next.js web app that connects to JIRA, Slack, and Houston via MCP (Model Context Protocol) servers to provide leadership visibility into project health, phase, risks, decisions, and issues.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — run ESLint

## Architecture

```
src/
  app/
    page.tsx              — renders the Dashboard component
    api/projects/route.ts — GET: fetches projects from JIRA MCP
    api/health-check/route.ts — GET: reports which MCP servers are configured vs missing
  components/
    Dashboard.tsx         — main dashboard with filtering (all/needs-help/at-risk/healthy)
    ProjectCard.tsx       — per-project card showing health, phase, risks, issues, decisions
    StatusBadge.tsx       — HealthBadge and PhaseBadge components
  lib/
    mcp-client.ts         — MCP client management: connects to servers defined in mcp-servers.json, caches clients, exposes callTool() and getAvailableServers()
    types.ts              — shared types: Project, ProjectHealth, Phase, HealthStatus, DashboardData
```

## MCP Server Configuration

Server connections are defined in `mcp-servers.json` at the project root. The app reads this at startup. Each entry specifies a command/args to launch the MCP server process via stdio transport.

Currently expected servers: `jira`, `slack`, `houston` (houston not yet configured).

## Key Patterns

- API routes act as the bridge between the React frontend and MCP servers — the browser never talks to MCP directly
- `callTool(serverName, toolName, args)` in `mcp-client.ts` is the primary way to invoke any MCP tool
- Health analysis (phase detection, risk identification, leadership-needed flags) is placeholder — will be built out as Slack and Houston integrations come online
- Types in `types.ts` define the data contract between API and frontend; `ProjectHealth` is the core entity

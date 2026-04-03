# LMS Data Bridge

## What This Is
A universal LMS data extraction + AI consumption platform. Two decoupled layers:

1. **Chrome Extension** (Layer 1 — Data Extraction): Scrapes data from any LMS (Blackboard first, then Canvas, Brightspace, Moodle) using session piggybacking. Normalizes into a common schema. Exports JSON to disk.
2. **MCP Server** (Layer 2 — AI Interface): Reads normalized JSON, exposes tools to Claude. Doesn't know or care which LMS the data came from.

The key design principle: **extraction and consumption are fully decoupled via a shared JSON schema.**

## Architecture

```
LMS (browser, authenticated session)
  → Chrome Extension (per-LMS plugin extracts data)
  → Normalized JSON schema (common format)
  → JSON file on disk (~/.lms-bridge/data.json)
  → MCP Server (reads JSON, exposes tools)
  → Claude Code / Claude Desktop
```

## Project Structure

```
/
├── CLAUDE.md
├── extension/                # Chrome Extension (Manifest V3, TypeScript)
│   ├── manifest.json
│   ├── src/
│   │   ├── background/       # Service worker
│   │   ├── content/          # Content scripts (LMS detection)
│   │   ├── plugins/          # Per-LMS extraction plugins
│   │   │   ├── types.ts      # Plugin interface
│   │   │   └── blackboard/   # Blackboard plugin (first)
│   │   ├── schema/           # Normalized data types
│   │   └── popup/            # Extension popup (sync status)
│   ├── tsconfig.json
│   └── package.json
├── mcp-server/               # MCP Server (TypeScript)
│   ├── src/
│   │   ├── index.ts          # Server entry point
│   │   ├── tools/            # MCP tool definitions
│   │   └── data.ts           # JSON data reader
│   ├── tsconfig.json
│   └── package.json
└── BlackboardAI Hub.md       # Original planning doc (Obsidian note)
```

## Common Data Schema

All LMS plugins normalize data into these types:
- `Course` — id, name, code, term, lmsSource
- `Assignment` — id, courseId, name, dueDate, status, pointsPossible, pointsEarned, lmsSource
- `Grade` — courseId, assignmentId, score, possible, percentage, letter
- `Announcement` — id, courseId, title, body, date
- `CalendarItem` — id, courseId, title, start, end, type

Every record has `lmsSource` (e.g. "blackboard", "canvas") and `lastSynced` timestamp.

## Data Flow
1. Extension detects LMS domain (content script on `*.blackboard.com`)
2. Injects fetch/XHR interceptor into page context (Blackboard Ultra's REST API is CORS-protected, so we capture the requests the UI already makes instead of making our own)
3. Intercepted API responses are parsed and normalized to common schema
4. Data accumulated in `chrome.storage.local`, merging with previous syncs
5. Extension exports JSON to `~/.lms-bridge/data.json` via Native Messaging host
6. MCP server reads JSON file, exposes query tools to Claude

**Important:** Direct `fetch()` to Blackboard REST endpoints fails due to CORS (redirects to `ultra.content.blackboardcdn.com`). The interception approach captures the same data without CORS issues.

## Tech Stack
- Chrome Extension: TypeScript, Manifest V3, Vite
- MCP Server: TypeScript, @modelcontextprotocol/sdk
- Build: Vite (extension), tsx (MCP server)
- No database — just JSON files for v1

## MCP Tools
```
lms_get_upcoming(days?)         — assignments due in next N days
lms_get_assignments(course?, status?, from?, to?)  — filtered assignments
lms_get_grades(course?)         — grades by course
lms_get_announcements(course?, limit?)  — recent announcements
lms_get_courses()               — enrolled courses
lms_get_calendar(from?, to?)    — calendar events
lms_search(query)               — full-text search across all data
```

## Key Blackboard REST Endpoints (session-authenticated)
```
GET /learn/api/public/v1/users/me
GET /learn/api/public/v1/users/{userId}/courses
GET /learn/api/public/v1/courses/{courseId}/contents
GET /learn/api/public/v1/courses/{courseId}/gradebook/columns
GET /learn/api/public/v1/courses/{courseId}/gradebook/columns/{id}/users/{userId}
GET /learn/api/public/v1/courses/{courseId}/announcements
GET /learn/api/public/v1/calendars/items
```

## Commands
- `cd extension && npm run dev` — build extension in watch mode
- `cd extension && npm run build` — production build
- `cd mcp-server && npm run build` — build MCP server
- `cd mcp-server && npm run dev` — run MCP server in dev mode

## Conventions
- TypeScript strict mode everywhere
- Plugin interface: each LMS plugin implements `LMSPlugin` interface
- All dates stored as ISO 8601 strings
- Tool names prefixed with `lms_` not `blackboard_` (LMS-agnostic)
- Keep extraction logic in plugins, keep normalization in schema layer
- No over-engineering: JSON files are fine, no database until proven needed

## Current Phase
Building Phase 1: Chrome extension scaffold + Blackboard plugin + MCP server with core tools.

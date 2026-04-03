# LMS Bridge — Roadmap

## What's Built (v0.1)

### Chrome Extension
- Manifest V3 extension with Vite + TypeScript
- Blackboard plugin: extracts courses, assignments, grades, announcements via REST API (v1 + v2)
- Direct fetch from content script using session cookies (same approach as Canvas Task Extension)
- Data stored in `chrome.storage.local`, pushed to MCP server via HTTP POST to `localhost:7890`
- Popup showing sync status and MCP server connection health
- Auto-re-syncs on SPA navigation within Blackboard

### MCP Server
- 8 tools exposed to Claude Desktop:
  - `lms_get_courses` — enrolled courses (current semester default)
  - `lms_get_upcoming` — due in next N days, excludes completed work
  - `lms_get_assignments` — full assignment list with filters
  - `lms_get_grades` — per-course averages + individual breakdowns
  - `lms_get_announcements` — recent announcements
  - `lms_get_calendar` — calendar events
  - `lms_search` — full-text search across all data
  - `lms_sync_status` — data freshness check
- HTTP server on `127.0.0.1:7890` receives data from extension
- In-memory cache + atomic disk writes to `~/.lms-bridge/data.json`
- Auto-detects current semester from course codes (e.g. `202630` = Spring 2026)
- Smart course matching: "math 182", "phys", "enee" all work
- Clean course name display: "202630 - MATH-182-31575" → "MATH 182"
- Relative date display: "TODAY", "tomorrow", "in 3 days"
- Grade calculation: correctly converts Blackboard's percentage scores to actual points

---

## Phase 2: Multi-LMS + Better Sync

### Canvas Support
- [ ] Add Canvas plugin to extension (`/api/v1/planner/items`, `/api/v1/users/self/todo`)
- [ ] Canvas uses Link header pagination (different from Blackboard's `paging.nextPage`)
- [ ] Canvas GraphQL for detailed grade data
- [ ] Content script matches `*.instructure.com` (already in manifest host_permissions)
- [ ] Data from both LMS platforms merges into same `data.json`

### Brightspace (D2L) Support
- [ ] Add Brightspace plugin (`/d2l/api/le/1.67/content/myItems/`)
- [ ] Detection via `d2l-body` CSS class

### Auto-Sync Without Browser
- [ ] Extract session cookie from Chrome's cookie store (via extension)
- [ ] Background daemon (Node.js) hits APIs on a schedule using saved cookie
- [ ] Cookie refresh detection — re-extract when expired
- [ ] Configurable sync interval (default: every 30 min)

### Data Freshness
- [ ] Timestamp each data type separately (courses might be fresh, grades stale)
- [ ] MCP tools warn when data is older than configurable threshold
- [ ] Extension badge shows time since last sync

---

## Phase 3: Intelligence Layer

### Priority & Planning Tools
- [ ] `lms_get_priorities` — combines upcoming deadlines + current grades to suggest what to focus on
- [ ] `lms_get_missing` — dedicated tool for missing/overdue assignments
- [ ] `lms_plan_week` — generates day-by-day schedule based on deadlines and difficulty
- [ ] Grade projection: "what do I need on the final to get an A?"

### Course Content
- [ ] Extract syllabi, lecture files, readings, links
- [ ] Store as separate content entries linked to courses
- [ ] Let Claude reference course materials when helping with assignments

### Obsidian Integration
- [ ] Auto-generate daily note section with today's deadlines
- [ ] Weekly summary template
- [ ] Link course notes to LMS data

---

## Phase 4: Polish & Distribution

### Extension UX
- [ ] Proper extension icon
- [ ] Settings page (sync interval, data directory, MCP server port)
- [ ] Manual "Sync Now" button in popup
- [ ] Sync history log

### Reliability
- [ ] Error recovery: retry failed API calls with backoff
- [ ] Partial sync: don't lose existing data if one course fails
- [ ] Session expiry detection and user notification

### Distribution
- [ ] Package as Chrome Web Store extension
- [ ] npm package for MCP server (`npx lms-bridge-mcp`)
- [ ] Setup wizard that configures Claude Desktop config automatically
- [ ] Documentation site

---

## Architecture Decisions Log

| Decision | Chosen | Why |
|----------|--------|-----|
| Data transport | HTTP POST to localhost | Native Messaging was unreliable (size limits, shebang issues, Chrome restarts) |
| Extraction method | Direct fetch from content script | Same-origin requests work with session cookies. XHR interception hit CSP issues. |
| API version | v1 + v2 mixed | v2 for gradebook columns/attempts, v1 for calendars/announcements (matching Canvas Task Extension) |
| Grade interpretation | `displayGrade.score` is a percentage | Blackboard returns 0-100 score, `col.score.possible` is question count, not point value |
| Term detection | Parse YYYYTT from course codes | Montgomery College uses `202630` = Spring 2026 pattern. Fallback: include unrecognized courses |
| Storage | JSON file on disk + in-memory cache | Simple, no database needed. Atomic writes via temp file + rename |

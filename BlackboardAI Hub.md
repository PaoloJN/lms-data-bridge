---
tags: [hub, MOC, project, blackboard, ai, chrome-extension]
created: 2026-04-02
status: active
---

# BlackboardAI Hub

> *Goal: Build a tool that lets AI access my college Blackboard data — so I can ask natural language questions like "what do I have due tomorrow?" and get real answers.*

## The Core Idea

Blackboard is where all my college work lives — assignments, due dates, grades, announcements, course materials. But the interface is terrible for actually knowing what I need to do. I want to bridge Blackboard's data into AI so I can just *ask* and get answers.

**The simplest version:** "What do I have due this week?" → AI checks my actual Blackboard data → gives me a real answer.

---

## Architecture Options

### Option A: Chrome Extension + MCP Server (Recommended)

```
Blackboard (browser) → Chrome Extension (scrapes/intercepts data)
        ↓
  Local storage (JSON)
        ↓
  Local MCP Server (reads stored data)
        ↓
  Claude Code / Claude Desktop (queries via MCP)
        ↓
  You ask: "What's due tomorrow?" → Real answer
```

**Why this is best:**
- MCP is the native way to give Claude access to external data
- You already use Claude Code daily — this plugs right into your workflow
- No API keys or institutional approval needed
- Data stays local on your machine
- You can ask questions from Claude Code or Claude Desktop directly

### Option B: Chrome Extension with Built-in AI Chat

```
Blackboard (browser) → Chrome Extension (scrapes data)
        ↓
  Extension popup/sidebar with chat UI
        ↓
  Claude API (sends scraped data as context)
        ↓
  Chat answers within the extension
```

**Pros:** Self-contained, could distribute to other students
**Cons:** Needs API key management, separate UI to maintain, can't use from Claude Code

### Option C: Both (Build A first, add B later)

Start with MCP for yourself. If it works well, wrap it in a standalone extension with its own chat UI for other students. The data layer is the same — only the AI interface changes.

---

## How Data Extraction Works

### The Strategy: Session Piggybacking

You don't need Blackboard's official API (requires institutional approval). Instead:

1. **Chrome extension runs on your Blackboard pages** (content script on `*.blackboard.com`)
2. **Your browser is already authenticated** — the extension inherits your session cookies
3. **Three extraction methods** (use all, prioritize by reliability):

| Method | How | Best For |
|--------|-----|----------|
| **REST API with session cookies** | `fetch('/learn/api/public/v1/...')` from extension using existing session | Assignments, grades, courses, announcements |
| **XHR/Fetch interception** | Intercept the AJAX calls Blackboard Ultra already makes | Structured JSON data the UI fetches |
| **DOM scraping** | Read the rendered page HTML | Fallback for anything the API doesn't expose |

### Key Blackboard REST Endpoints (work with session auth)

```
GET /learn/api/public/v1/users/me                              → your user info
GET /learn/api/public/v1/users/{userId}/courses                 → your enrolled courses
GET /learn/api/public/v1/courses/{courseId}/contents             → course content tree
GET /learn/api/public/v1/courses/{courseId}/gradebook/columns    → assignments + due dates
GET /learn/api/public/v1/courses/{courseId}/gradebook/columns/{id}/users/{userId}  → your grade
GET /learn/api/public/v1/courses/{courseId}/announcements        → course announcements
GET /learn/api/public/v1/calendars/items                        → calendar items (Ultra)
```

### Data to Capture

| Data Type | What | Priority |
|-----------|------|----------|
| **Assignments** | Name, course, due date, status (submitted/not), points possible | P0 — this is the core |
| **Grades** | Current grade per course, grade per assignment | P0 |
| **Announcements** | Course announcements, dates, content | P1 |
| **Course content** | Lecture files, readings, links, syllabus | P1 |
| **Calendar items** | Exams, events, deadlines | P1 |
| **Submission details** | What you've submitted, feedback received | P2 |

---

## MCP Server Design

The MCP server is a lightweight local process that reads the scraped data and exposes it to Claude.

### Tools to Expose

```
blackboard_get_upcoming        → assignments due in the next N days
blackboard_get_assignments     → all assignments, filterable by course/status/date
blackboard_get_grades          → current grades by course or specific assignment
blackboard_get_announcements   → recent announcements, filterable by course
blackboard_get_courses         → list of enrolled courses
blackboard_get_course_content  → content/materials for a specific course
blackboard_get_calendar        → calendar events and deadlines
blackboard_search              → full-text search across all scraped data
```

### Example Interactions

**You:** "What do I have due tomorrow?"
**Claude (via MCP):** Calls `blackboard_get_upcoming(days=1)` → "You have 2 things due tomorrow: CS301 Problem Set 4 (11:59 PM) and ENG200 Essay Draft (5:00 PM)."

**You:** "What's my grade in CS301?"
**Claude (via MCP):** Calls `blackboard_get_grades(course="CS301")` → "Your current grade in CS301 is 87.3%. Here's the breakdown: ..."

**You:** "Summarize the latest announcements"
**Claude (via MCP):** Calls `blackboard_get_announcements(limit=5)` → Summarizes recent announcements across courses.

**You:** "What should I prioritize this week?"
**Claude (via MCP):** Calls `blackboard_get_upcoming(days=7)` + `blackboard_get_grades()` → Cross-references deadlines with grades to suggest priorities.

---

## Tech Stack

| Component | Tech | Why |
|-----------|------|-----|
| Chrome extension | TypeScript, Manifest V3 | Modern, type-safe, what Canvas extension uses |
| Data storage | `chrome.storage.local` + JSON files on disk | Extension stores, MCP server reads |
| MCP server | TypeScript or Python | Reads JSON data, exposes tools to Claude |
| Build | Webpack or Vite | Fast builds, HMR for development |

### Reference Code
- **Canvas Task Extension** — `github.com/UseBetterCanvas/canvas-task-extension` — already has a Blackboard plugin, same session-auth pattern, same data extraction approach. Study `src/pages/Content/modules/plugins/blackboard/` specifically
- **BlackboardSync** — `github.com/sanjacob/BlackboardSync` — Python app that syncs Blackboard files using session-based REST API access

---

## Build Phases

### Phase 1: Data Layer 
- [ ] Set up Chrome extension scaffold (Manifest V3, TypeScript)
- [ ] Implement Blackboard detection (content script on `*.blackboard.com`)
- [ ] Build REST API fetcher using session cookies (courses, assignments, grades)
- [ ] Store structured data in `chrome.storage.local` + export to JSON on disk
- [ ] Test on your actual Blackboard instance — confirm data extraction works
- **Milestone:** Extension can scrape and store your real assignment/grade data

### Phase 2: MCP Server 
- [ ] Build MCP server that reads the exported JSON data
- [ ] Implement core tools: `get_upcoming`, `get_assignments`, `get_grades`
- [ ] Connect to Claude Code — test natural language queries
- [ ] Handle data freshness (timestamp when data was last scraped, warn if stale)
- **Milestone:** Ask Claude "what's due this week?" and get a real answer

### Phase 3: Polish & Expand 
- [ ] Add announcements, course content, and calendar scraping
- [ ] Add `search` tool for full-text search across all data
- [ ] Build auto-refresh (re-scrape when you visit Blackboard, or on a schedule)
- [ ] Add extension popup showing sync status and last refresh time
- **Milestone:** Full college data accessible through Claude

### Phase 4: Intelligence Layer 
- [ ] Priority scoring — Claude can weigh deadlines against grades to suggest what to focus on
- [ ] Weekly planning — "plan my week based on what's due"
- [ ] Study scheduling — "when should I start studying for the CS301 exam?"
- [ ] Grade projection — "what do I need on the final to get an A?"
- **Milestone:** AI doesn't just report data — it helps you make decisions

---

## Ways to Expand This Further

### Short-term Improvements
- **Notifications** — Chrome notifications for upcoming deadlines (24h, 48h before)
- **Obsidian integration** — Auto-generate a daily note section with today's deadlines from Blackboard
- **Multi-LMS support** — Add Canvas support using the same architecture (many colleges use both)
- **Offline access** — All data stored locally, works even when Blackboard is down

### Medium-term Ideas
- **Study material extraction** — Pull lecture slides, PDFs, and readings and let Claude summarize them
- **Assignment helper** — "Help me start the CS301 problem set" → Claude reads the assignment description and gives you a structured approach
- **Class notes integration** — Connect your own notes (from Obsidian) with course content for a unified knowledge base
- **Group project coordination** — Track group assignments, who's doing what, deadlines

### Bigger Vision
- **Full academic AI assistant** — Not just Blackboard, but email, calendar, notes, all connected through MCP
- **Distribute to other students** — Package as a polished extension with built-in chat (Option B), charge $5-10/month
- **Multi-school support** — Blackboard + Canvas + Brightspace + Moodle → one tool for any LMS
- **Academic performance analytics** — Track trends over time, predict grade outcomes, identify weak areas early

---

## Guiding Principles

1. **Get real data flowing first.** Don't build UI or features until you can reliably extract assignment data from your actual Blackboard
2. **Your instance is the test.** Build for your school's Blackboard first. Generalize later
3. **MCP-first.** The fastest path to value is Claude answering questions about your real data. The chrome extension is just the data pipe
4. **Don't over-engineer early.** A JSON file that gets overwritten on each scrape is fine for v1. Database comes later if needed
5. **This can become a product.** Every college student has this problem. Build for yourself first, but keep in mind this could be something you sell

---

## Current Focus

- [ ] Study the Canvas Task Extension's Blackboard plugin code — understand exactly how they extract data
- [ ] Set up Chrome extension development environment
- [ ] Test which Blackboard REST endpoints work with session cookies on your school's instance
- [ ] Build the simplest possible scraper: get courses + assignments with due dates

---

## Key Questions to Answer Early

1. Does your school use Blackboard Original or Ultra? (Ultra = easier data extraction via AJAX interception)
2. Which REST endpoints work with just session cookies vs. needing OAuth?
3. How often does the data need to refresh? (Every time you open Blackboard? Hourly? On-demand?)
4. Where should the JSON data live so the MCP server can read it? (`~/.blackboard-ai/data.json`?)

---

## Links
- Parent: [[200 Areas/College/College Hub]]
- Related: [[200 Areas/Personal/Skills & Tools]], [[000 Inbox/Making Money with Claude Code and AI]]
- Reference: Canvas Task Extension (`github.com/UseBetterCanvas/canvas-task-extension`)
- Reference: BlackboardSync (`github.com/sanjacob/BlackboardSync`)

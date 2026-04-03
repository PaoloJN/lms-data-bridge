# LMS Data Bridge

A universal LMS data extraction and AI consumption platform. Extract structured data from any Learning Management System via a Chrome extension, then query it through an MCP server with Claude.

## How It Works

```
LMS (authenticated browser session)
  → Chrome Extension (per-LMS plugin extracts + normalizes data)
  → JSON file on disk (~/.lms-bridge/data.json)
  → MCP Server (exposes query tools to Claude)
```

**Key idea:** extraction and consumption are fully decoupled through a shared JSON schema. The MCP server doesn't know or care which LMS the data came from.

## Components

### Chrome Extension (`/extension`)

Manifest V3 extension that piggybacks on your authenticated LMS session. Instead of making its own API calls (which hit CORS restrictions), it intercepts the requests the LMS UI already makes and normalizes the responses into a common schema.

**Supported LMS platforms:**
- Blackboard Ultra (in progress)
- Canvas, Brightspace, Moodle (planned)

### MCP Server (`/mcp-server`)

Reads the normalized JSON export and exposes tools for Claude to query your academic data:

| Tool | Description |
|------|-------------|
| `lms_get_courses()` | List enrolled courses |
| `lms_get_upcoming(days?)` | Assignments due in next N days |
| `lms_get_assignments(course?, status?, from?, to?)` | Filtered assignments |
| `lms_get_grades(course?)` | Grades by course |
| `lms_get_announcements(course?, limit?)` | Recent announcements |
| `lms_get_calendar(from?, to?)` | Calendar events |
| `lms_search(query)` | Full-text search across all data |

## Getting Started

### Extension

```bash
cd extension
npm install
npm run dev    # build in watch mode
npm run build  # production build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### MCP Server

```bash
cd mcp-server
npm install
npm run build
npm run dev    # run in dev mode
```

Add to your Claude Code or Claude Desktop MCP config to connect.

## Data Schema

All LMS plugins normalize data into common types:

- **Course** — id, name, code, term
- **Assignment** — id, courseId, name, dueDate, status, points
- **Grade** — courseId, assignmentId, score, possible, percentage, letter
- **Announcement** — id, courseId, title, body, date
- **CalendarItem** — id, courseId, title, start, end, type

Every record includes `lmsSource` and `lastSynced` for traceability.

## Tech Stack

- **Extension:** TypeScript, Manifest V3, Vite
- **MCP Server:** TypeScript, `@modelcontextprotocol/sdk`
- **Storage:** JSON files (no database for v1)

## License

MIT

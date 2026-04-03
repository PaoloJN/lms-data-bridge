import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadData, getDataAge, startHttpServer } from "./data.js";
import type { Assignment, Grade, Announcement } from "./data.js";

const server = new McpServer({
  name: "lms-bridge",
  version: "0.1.0",
});

// --- Helpers ---

// Smart course matching: "math 182", "MATH-182", "math", "enee" all work
// Matches against course name, code, and extracted subject+number
function matchesCourse(courseName: string, courseId: string, query: string): boolean {
  const q = query.toLowerCase().replace(/[-_]/g, " ").trim();
  const name = courseName.toLowerCase().replace(/[-_]/g, " ");
  const code = courseId.toLowerCase().replace(/[-_]/g, " ");

  // Direct substring match
  if (name.includes(q) || code.includes(q)) return true;

  // Extract subject+number from name like "202630 - MATH-182-31575"
  // or "MGMT 210: Entrepreneurial Opportunity..."
  const subjectMatch = courseName.match(/([A-Z]{2,5})[\s\-_]?(\d{3})/i);
  if (subjectMatch) {
    const subject = subjectMatch[1].toLowerCase();
    const num = subjectMatch[2];
    const normalized = `${subject} ${num}`;
    if (normalized.includes(q) || q.includes(subject)) return true;
  }

  return false;
}

function filterByCourse<T extends { courseName: string; courseId: string }>(
  items: T[],
  course: string | undefined
): T[] {
  if (!course) return items;
  return items.filter((item) => matchesCourse(item.courseName, item.courseId, course));
}

// Clean up course display name: "202630 - MATH-182-31575" → "MATH-182 (Spring 2026)"
function cleanCourseName(name: string): string {
  // Try to extract the meaningful part
  const match = name.match(/([A-Z]{2,5}[\s\-]\d{3}[A-Z]?)/i);
  if (match) return match[1].replace("-", " ");
  // For names like "MGMT 210: Entrepreneurial..." just return as-is
  return name;
}

function formatDueDate(dueDate: string): string {
  const d = new Date(dueDate);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (diffDays === 0) return `${dateStr} (TODAY)`;
  if (diffDays === 1) return `${dateStr} (tomorrow)`;
  if (diffDays > 1 && diffDays <= 7) return `${dateStr} (in ${diffDays} days)`;
  if (diffDays < 0) return `${dateStr} (${Math.abs(diffDays)} days ago)`;
  return dateStr;
}

// --- Tool: lms_get_courses ---
server.tool(
  "lms_get_courses",
  "Get all enrolled courses with their IDs and names.",
  { source: z.string().optional().describe('Filter by LMS source (e.g. "blackboard", "canvas")') },
  async (args) => {
    const data = loadData();
    let courses = data.courses ?? [];
    if (args.source) {
      courses = courses.filter((c) => c.lmsSource === args.source);
    }
    if (courses.length === 0) {
      return { content: [{ type: "text", text: "No courses found. Sync data by visiting your LMS with the extension installed." }] };
    }
    const text = courses
      .map((c) => `- **${cleanCourseName(c.name)}** — ${c.name}`)
      .join("\n");
    return { content: [{ type: "text", text: `${courses.length} courses:\n\n${text}` }] };
  }
);

// --- Tool: lms_get_upcoming ---
server.tool(
  "lms_get_upcoming",
  "Get assignments due in the next N days that haven't been completed yet. Perfect for 'what do I have due this week?' Excludes already-graded and submitted work.",
  {
    days: z.number().optional().describe("Days to look ahead (default: 7)"),
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'enee', 'mgmt')"),
  },
  async (args) => {
    const data = loadData();
    const days = args.days ?? 7;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);

    let assignments = (data.assignments ?? []).filter((a) => {
      if (!a.dueDate) return false;
      const due = new Date(a.dueDate);
      if (due < now || due > cutoff) return false;
      // Exclude already completed work
      if (a.status === "graded" || a.status === "submitted") return false;
      return true;
    });

    assignments = filterByCourse(assignments, args.course);
    assignments.sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    if (assignments.length === 0) {
      return { content: [{ type: "text", text: `No upcoming assignments due in the next ${days} days.` }] };
    }

    const text = assignments.map((a) => {
      const due = formatDueDate(a.dueDate!);
      const pts = a.pointsPossible != null ? ` [${a.pointsPossible} pts]` : "";
      return `- **${a.name}** — ${cleanCourseName(a.courseName)}\n  ${due}${pts}`;
    }).join("\n");

    return { content: [{ type: "text", text: `${assignments.length} upcoming assignments (next ${days} days):\n\n${text}` }] };
  }
);

// --- Tool: lms_get_assignments ---
server.tool(
  "lms_get_assignments",
  "Get all assignments, filterable by course, status, and date range. Use this for detailed assignment queries.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'phys', 'comm 108')"),
    status: z.enum(["upcoming", "submitted", "graded", "missing", "unknown"]).optional().describe("Filter by status"),
    from: z.string().optional().describe("Start date (ISO 8601)"),
    to: z.string().optional().describe("End date (ISO 8601)"),
  },
  async (args) => {
    const data = loadData();
    let assignments = filterByCourse(data.assignments ?? [], args.course);

    if (args.status) assignments = assignments.filter((a) => a.status === args.status);
    if (args.from) {
      const from = new Date(args.from);
      assignments = assignments.filter((a) => a.dueDate && new Date(a.dueDate) >= from);
    }
    if (args.to) {
      const to = new Date(args.to);
      assignments = assignments.filter((a) => a.dueDate && new Date(a.dueDate) <= to);
    }

    assignments.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    if (assignments.length === 0) {
      return { content: [{ type: "text", text: "No assignments found matching those filters." }] };
    }

    const text = assignments.map((a) => {
      const due = a.dueDate ? formatDueDate(a.dueDate) : "No due date";
      const points = a.pointsEarned != null && a.pointsPossible != null
        ? ` [${a.pointsEarned}/${a.pointsPossible}]`
        : a.pointsPossible != null ? ` [${a.pointsPossible} pts]` : "";
      return `- **${a.name}** — ${cleanCourseName(a.courseName)}\n  ${due} | ${a.status}${points}`;
    }).join("\n");

    return { content: [{ type: "text", text: `${assignments.length} assignments:\n\n${text}` }] };
  }
);

// --- Tool: lms_get_grades ---
server.tool(
  "lms_get_grades",
  "Get grades. Filter by course. Use summary=true for a per-course GPA overview. Default shows individual grades.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'comm', 'mgmt 210')"),
    summary: z.boolean().optional().describe("If true, show per-course weighted averages instead of individual grades"),
  },
  async (args) => {
    const data = loadData();
    let grades = data.grades ?? [];

    if (args.course) {
      grades = grades.filter((g) => matchesCourse(g.courseName, g.courseId, args.course!));
    }

    if (grades.length === 0) {
      return { content: [{ type: "text", text: "No grades found." }] };
    }

    if (args.summary !== false) {
      // Default to summary view — more useful
      const byCourse = new Map<string, { name: string; totalScore: number; totalPossible: number; count: number }>();
      for (const g of grades) {
        if (g.score == null || g.possible == null) continue;
        const entry = byCourse.get(g.courseId) ?? { name: g.courseName, totalScore: 0, totalPossible: 0, count: 0 };
        entry.totalScore += g.score;
        entry.totalPossible += g.possible;
        entry.count++;
        byCourse.set(g.courseId, entry);
      }

      if (byCourse.size === 0) {
        return { content: [{ type: "text", text: "No graded items with scores found." }] };
      }

      const lines = [...byCourse.values()]
        .sort((a, b) => (a.totalScore / a.totalPossible) - (b.totalScore / b.totalPossible))
        .map((c) => {
          const pct = ((c.totalScore / c.totalPossible) * 100).toFixed(1);
          return `- **${cleanCourseName(c.name)}**: ${pct}% (${c.totalScore}/${c.totalPossible} across ${c.count} items)`;
        });

      // If filtering by one course, also show individual grades
      if (args.course && byCourse.size === 1) {
        const individualGrades = grades
          .filter((g) => g.score != null && g.possible != null)
          .map((g) => `  - ${g.assignmentName}: ${g.score}/${g.possible} (${g.percentage?.toFixed(1)}%)`)
          .join("\n");
        return { content: [{ type: "text", text: `${lines.join("\n")}\n\nBreakdown:\n${individualGrades}` }] };
      }

      return { content: [{ type: "text", text: `Grade summary (sorted lowest to highest):\n\n${lines.join("\n")}` }] };
    }

    // Individual grades
    const text = grades
      .filter((g) => g.score != null)
      .map((g) => {
        const pct = g.percentage != null ? ` (${g.percentage.toFixed(1)}%)` : "";
        return `- **${g.assignmentName}** — ${cleanCourseName(g.courseName)}: ${g.score}/${g.possible}${pct}`;
      })
      .join("\n");
    return { content: [{ type: "text", text: `${grades.length} grades:\n\n${text}` }] };
  }
);

// --- Tool: lms_get_announcements ---
server.tool(
  "lms_get_announcements",
  "Get recent announcements from courses.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'enes', 'phys 161')"),
    limit: z.number().optional().describe("Max announcements to return (default: 10)"),
  },
  async (args) => {
    const data = loadData();
    let announcements = data.announcements ?? [];

    if (args.course) {
      announcements = announcements.filter((a) => matchesCourse(a.courseName, a.courseId, args.course!));
    }

    announcements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    announcements = announcements.slice(0, args.limit ?? 10);

    if (announcements.length === 0) {
      return { content: [{ type: "text", text: "No announcements found." }] };
    }

    const text = announcements.map((a) => {
      const date = new Date(a.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      // Strip HTML for cleaner display
      const body = a.body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      const truncated = body.length > 300 ? body.slice(0, 300) + "..." : body;
      return `### ${a.title}\n**${cleanCourseName(a.courseName)}** — ${date}\n\n${truncated}`;
    }).join("\n\n---\n\n");

    return { content: [{ type: "text", text }] };
  }
);

// --- Tool: lms_get_calendar ---
server.tool(
  "lms_get_calendar",
  "Get calendar events and deadlines. Note: if calendar is empty, use lms_get_upcoming instead — assignments with due dates serve as the calendar.",
  {
    from: z.string().optional().describe("Start date (ISO 8601). Defaults to today."),
    to: z.string().optional().describe("End date (ISO 8601). Defaults to 30 days from now."),
    course: z.string().optional().describe("Filter by course"),
  },
  async (args) => {
    const data = loadData();
    const from = args.from ? new Date(args.from) : new Date();
    const to = args.to ? new Date(args.to) : new Date(Date.now() + 30 * 86400000);

    let items = (data.calendar ?? []).filter((item) => {
      const start = new Date(item.start);
      return start >= from && start <= to;
    });

    if (args.course) {
      items = items.filter((i) => i.courseName && matchesCourse(i.courseName, i.courseId ?? "", args.course!));
    }

    items.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    if (items.length === 0) {
      // Suggest using upcoming assignments instead
      const upcoming = (data.assignments ?? []).filter((a) => {
        if (!a.dueDate) return false;
        const due = new Date(a.dueDate);
        return due >= from && due <= to && a.status !== "graded";
      });
      if (upcoming.length > 0) {
        return { content: [{ type: "text", text: `No calendar events found, but there are ${upcoming.length} assignments with due dates in that range. Use lms_get_upcoming to see them.` }] };
      }
      return { content: [{ type: "text", text: "No calendar events found in that range." }] };
    }

    const text = items.map((i) => {
      const date = formatDueDate(i.start);
      const course = i.courseName ? ` — ${cleanCourseName(i.courseName)}` : "";
      return `- **${i.title}**${course}\n  ${date} [${i.type}]`;
    }).join("\n");

    return { content: [{ type: "text", text: `${items.length} calendar events:\n\n${text}` }] };
  }
);

// --- Tool: lms_search ---
server.tool(
  "lms_search",
  "Full-text search across all LMS data — courses, assignments, announcements. Use when the question doesn't map to a specific tool.",
  { query: z.string().describe("Search query (case-insensitive)") },
  async (args) => {
    const data = loadData();
    const q = args.query.toLowerCase();
    const results: string[] = [];

    for (const c of data.courses ?? []) {
      if (c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) {
        results.push(`[Course] **${cleanCourseName(c.name)}** (${c.name})`);
      }
    }
    for (const a of data.assignments ?? []) {
      if (a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)) {
        const due = a.dueDate ? ` — due ${formatDueDate(a.dueDate)}` : "";
        results.push(`[Assignment] **${a.name}** (${cleanCourseName(a.courseName)})${due} [${a.status}]`);
      }
    }
    for (const a of data.announcements ?? []) {
      if (a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)) {
        const date = new Date(a.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        results.push(`[Announcement] **${a.title}** (${cleanCourseName(a.courseName)}) — ${date}`);
      }
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No results for "${args.query}".` }] };
    }
    return { content: [{ type: "text", text: `${results.length} results for "${args.query}":\n\n${results.join("\n")}` }] };
  }
);

// --- Tool: lms_sync_status ---
server.tool(
  "lms_sync_status",
  "Check when LMS data was last synced and whether it might be stale.",
  {},
  async () => {
    const info = getDataAge();
    const data = loadData();
    if (!info.exists) {
      return {
        content: [{
          type: "text",
          text: `No data file found.\n\nTo sync:\n1. Install the LMS Bridge Chrome extension\n2. Visit your LMS (e.g. Blackboard)\n3. The extension will automatically extract and export your data`,
        }],
      };
    }
    const stale = info.ageMinutes != null && info.ageMinutes > 60;
    const ageText = info.ageMinutes != null
      ? info.ageMinutes < 1 ? "just now" : `${info.ageMinutes} minutes ago`
      : "unknown";
    const summary = `Last synced: ${ageText}\nCourses: ${data.courses?.length ?? 0} | Assignments: ${data.assignments?.length ?? 0} | Grades: ${data.grades?.length ?? 0} | Announcements: ${data.announcements?.length ?? 0}`;
    return {
      content: [{
        type: "text",
        text: summary + (stale ? "\n\nData may be stale. Visit your LMS to refresh." : ""),
      }],
    };
  }
);

// Start the server
async function main() {
  startHttpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[LMS Bridge MCP] Server started");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

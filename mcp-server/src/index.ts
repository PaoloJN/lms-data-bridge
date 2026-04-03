import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadData, getDataAge, startHttpServer } from "./data.js";
import type { Assignment, Grade, Announcement } from "./data.js";

const server = new McpServer({
  name: "lms-bridge",
  version: "0.1.0",
});

// --- Term Detection ---

// Blackboard course codes follow pattern: XXXXX.YYYYTT
// YYYY = year, TT = term (10=Summer, 20=Fall, 24=Winter, 30=Spring)
const TERM_NAMES: Record<string, string> = {
  "10": "Summer",
  "20": "Fall",
  "24": "Winter",
  "30": "Spring",
};

interface TermInfo {
  code: string;    // e.g. "202630"
  year: number;    // e.g. 2026
  termCode: string; // e.g. "30"
  label: string;   // e.g. "Spring 2026"
}

function extractTerm(courseCode: string): TermInfo | null {
  // Match YYYYTT at end of code like "31575.202630" or in name like "202630 - MATH..."
  const match = courseCode.match(/(20\d{2})(10|20|24|30)/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const termCode = match[2];
  return {
    code: match[1] + match[2],
    year,
    termCode,
    label: `${TERM_NAMES[termCode] || termCode} ${year}`,
  };
}

// Detect current term from the data — the most recent term code found
function detectCurrentTerm(courses: { code: string; name: string }[]): TermInfo | null {
  const terms = new Map<string, TermInfo>();
  for (const c of courses) {
    // Check both code and name for term info
    const term = extractTerm(c.code) || extractTerm(c.name);
    if (term) terms.set(term.code, term);
  }
  if (terms.size === 0) return null;
  // Return the most recent (highest code = most recent term)
  return [...terms.values()].sort((a, b) => b.code.localeCompare(a.code))[0];
}

function isCurrentTerm(courseCode: string, courseName: string, currentTermCode: string): boolean {
  const term = extractTerm(courseCode) || extractTerm(courseName);
  if (!term) return true; // If we can't detect term, include it (e.g. "PHYS_161_General_Physics_I")
  return term.code === currentTermCode;
}

// Filter any array of items with courseId/courseName to current term only
function filterCurrentTerm<T extends { courseId: string; courseName: string }>(
  items: T[],
  courses: { id: string; code: string; name: string }[],
  currentTermCode: string | null,
): T[] {
  if (!currentTermCode) return items;
  // Build set of current-term course IDs
  const currentCourseIds = new Set(
    courses
      .filter((c) => isCurrentTerm(c.code, c.name, currentTermCode))
      .map((c) => c.id)
  );
  return items.filter((item) => currentCourseIds.has(item.courseId));
}

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

// Clean up course display name: "202630 - MATH-182-31575" → "MATH 182"
function cleanCourseName(name: string): string {
  // Try to extract the meaningful part (e.g. MATH-182, COMM-108, ENEE-244)
  const match = name.match(/([A-Z]{2,5})[\s\-_]?(\d{3}[A-Z]?)/i);
  if (match) return `${match[1]} ${match[2]}`.toUpperCase();
  // For names like "MGMT 210: Entrepreneurial..." extract just the code
  const colonMatch = name.match(/^([A-Z]{2,5}\s+\d{3})/i);
  if (colonMatch) return colonMatch[1].toUpperCase();
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
  "Get enrolled courses. Defaults to current semester only. Set all_terms=true to see all.",
  {
    all_terms: z.boolean().optional().describe("Show courses from all terms, not just current (default: false)"),
    source: z.string().optional().describe('Filter by LMS source (e.g. "blackboard", "canvas")'),
  },
  async (args) => {
    const data = loadData();
    let courses = data.courses ?? [];
    const currentTerm = detectCurrentTerm(courses);

    if (args.source) {
      courses = courses.filter((c) => c.lmsSource === args.source);
    }
    if (!args.all_terms && currentTerm) {
      courses = courses.filter((c) => isCurrentTerm(c.code, c.name, currentTerm.code));
    }
    if (courses.length === 0) {
      return { content: [{ type: "text", text: "No courses found. Sync data by visiting your LMS with the extension installed." }] };
    }

    const termLabel = currentTerm ? ` (${currentTerm.label})` : "";
    const header = args.all_terms
      ? `All ${courses.length} courses:`
      : `${courses.length} current courses${termLabel}:`;

    const text = courses
      .map((c) => {
        const term = extractTerm(c.code) || extractTerm(c.name);
        const termSuffix = args.all_terms && term ? ` [${term.label}]` : "";
        return `- **${cleanCourseName(c.name)}**${termSuffix}`;
      })
      .join("\n");
    return { content: [{ type: "text", text: `${header}\n\n${text}` }] };
  }
);

// --- Tool: lms_get_upcoming ---
server.tool(
  "lms_get_upcoming",
  "Get assignments due in the next N days that haven't been completed yet. Perfect for 'what do I have due this week?' Excludes already-graded and submitted work. Only shows current semester.",
  {
    days: z.number().optional().describe("Days to look ahead (default: 7)"),
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'enee', 'mgmt')"),
  },
  async (args) => {
    const data = loadData();
    const days = args.days ?? 7;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);
    const currentTerm = detectCurrentTerm(data.courses ?? []);

    let assignments = filterCurrentTerm(data.assignments ?? [], data.courses ?? [], currentTerm?.code ?? null);

    assignments = assignments.filter((a) => {
      if (!a.dueDate) return false;
      const due = new Date(a.dueDate);
      if (due < now || due > cutoff) return false;
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
  "Get all assignments, filterable by course, status, and date range. Current semester only by default. Set all_terms=true to include past semesters.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'phys', 'comm 108')"),
    status: z.enum(["upcoming", "submitted", "graded", "missing", "unknown"]).optional().describe("Filter by status"),
    from: z.string().optional().describe("Start date (ISO 8601)"),
    to: z.string().optional().describe("End date (ISO 8601)"),
    all_terms: z.boolean().optional().describe("Include past semesters (default: false)"),
  },
  async (args) => {
    const data = loadData();
    const currentTerm = detectCurrentTerm(data.courses ?? []);
    let assignments = args.all_terms
      ? (data.assignments ?? [])
      : filterCurrentTerm(data.assignments ?? [], data.courses ?? [], currentTerm?.code ?? null);
    assignments = filterByCourse(assignments, args.course);

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
  "Get grades. Filter by course. Defaults to current semester summary view (per-course averages sorted lowest first). Set summary=false for individual grades. Set all_terms=true for past semesters.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'math 182', 'comm', 'mgmt 210')"),
    summary: z.boolean().optional().describe("If true (default), show per-course averages. If false, show individual grades."),
    all_terms: z.boolean().optional().describe("Include past semesters (default: false)"),
  },
  async (args) => {
    const data = loadData();
    const currentTerm = detectCurrentTerm(data.courses ?? []);
    let grades = args.all_terms
      ? (data.grades ?? [])
      : filterCurrentTerm(data.grades ?? [], data.courses ?? [], currentTerm?.code ?? null);

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
  "Get recent announcements from courses. Current semester only by default.",
  {
    course: z.string().optional().describe("Filter by course (e.g. 'enes', 'phys 161')"),
    limit: z.number().optional().describe("Max announcements to return (default: 10)"),
    all_terms: z.boolean().optional().describe("Include past semesters (default: false)"),
  },
  async (args) => {
    const data = loadData();
    const currentTerm = detectCurrentTerm(data.courses ?? []);
    let announcements = args.all_terms
      ? (data.announcements ?? [])
      : filterCurrentTerm(data.announcements ?? [], data.courses ?? [], currentTerm?.code ?? null);

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
  "Full-text search across all LMS data — courses, assignments, announcements. Current semester only by default.",
  {
    query: z.string().describe("Search query (case-insensitive)"),
    all_terms: z.boolean().optional().describe("Search across all semesters (default: false)"),
  },
  async (args) => {
    const data = loadData();
    const q = args.query.toLowerCase();
    const currentTerm = detectCurrentTerm(data.courses ?? []);
    const termCode = args.all_terms ? null : (currentTerm?.code ?? null);
    const results: string[] = [];

    const courses = data.courses ?? [];
    const assignments = termCode ? filterCurrentTerm(data.assignments ?? [], courses, termCode) : (data.assignments ?? []);
    const announcements = termCode ? filterCurrentTerm(data.announcements ?? [], courses, termCode) : (data.announcements ?? []);

    for (const c of courses.filter(c => !termCode || isCurrentTerm(c.code, c.name, termCode))) {
      if (c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) {
        results.push(`[Course] **${cleanCourseName(c.name)}** (${c.name})`);
      }
    }
    for (const a of assignments) {
      if (a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)) {
        const due = a.dueDate ? ` — due ${formatDueDate(a.dueDate)}` : "";
        results.push(`[Assignment] **${a.name}** (${cleanCourseName(a.courseName)})${due} [${a.status}]`);
      }
    }
    for (const a of announcements) {
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

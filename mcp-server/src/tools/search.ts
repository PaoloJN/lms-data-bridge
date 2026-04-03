import { loadData } from "../data.js";

export const lms_search = {
  name: "lms_search",
  description:
    "Full-text search across all LMS data — courses, assignments, grades, announcements, and calendar items. Use this when the user's question doesn't map cleanly to a specific data type.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query (case-insensitive, matches against names, titles, and bodies)",
      },
    },
    required: ["query"],
  },
  handler(args: { query: string }) {
    const data = loadData();
    const q = args.query.toLowerCase();
    const results: string[] = [];

    // Search courses
    for (const c of data.courses) {
      if (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
      ) {
        results.push(`[Course] **${c.name}** (${c.code})`);
      }
    }

    // Search assignments
    for (const a of data.assignments) {
      if (
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
      ) {
        const due = a.dueDate
          ? ` — due ${new Date(a.dueDate).toLocaleDateString()}`
          : "";
        results.push(
          `[Assignment] **${a.name}** (${a.courseName})${due}`
        );
      }
    }

    // Search announcements
    for (const a of data.announcements) {
      if (
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q)
      ) {
        results.push(
          `[Announcement] **${a.title}** (${a.courseName}) — ${new Date(a.date).toLocaleDateString()}`
        );
      }
    }

    // Search calendar
    for (const c of data.calendar) {
      if (c.title.toLowerCase().includes(q)) {
        results.push(
          `[Calendar] **${c.title}** — ${new Date(c.start).toLocaleDateString()}`
        );
      }
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results found for "${args.query}".`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} results for "${args.query}":\n\n${results.join("\n")}`,
        },
      ],
    };
  },
};

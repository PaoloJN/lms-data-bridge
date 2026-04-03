import { loadData } from "../data.js";

export const lms_get_announcements = {
  name: "lms_get_announcements",
  description:
    "Get recent announcements from courses. Returns title, body, course, and date.",
  inputSchema: {
    type: "object" as const,
    properties: {
      course: {
        type: "string",
        description: "Filter by course name (partial match, case-insensitive)",
      },
      limit: {
        type: "number",
        description: "Max number of announcements to return (default: 10)",
      },
    },
  },
  handler(args: { course?: string; limit?: number }) {
    const data = loadData();
    let announcements = data.announcements;

    if (args.course) {
      const q = args.course.toLowerCase();
      announcements = announcements.filter((a) =>
        a.courseName.toLowerCase().includes(q)
      );
    }

    // Sort by date descending (newest first)
    announcements.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const limit = args.limit ?? 10;
    announcements = announcements.slice(0, limit);

    if (announcements.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No announcements found." }],
      };
    }

    const text = announcements
      .map((a) => {
        const date = new Date(a.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        // Truncate long bodies
        const body =
          a.body.length > 200 ? a.body.slice(0, 200) + "..." : a.body;
        return `### ${a.title}\n**${a.courseName}** — ${date}\n\n${body}`;
      })
      .join("\n\n---\n\n");

    return {
      content: [{ type: "text" as const, text }],
    };
  },
};

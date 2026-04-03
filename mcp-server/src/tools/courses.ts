import { loadData } from "../data.js";

export const lms_get_courses = {
  name: "lms_get_courses",
  description:
    "Get all enrolled courses. Returns course name, code, term, and LMS source.",
  inputSchema: {
    type: "object" as const,
    properties: {
      source: {
        type: "string",
        description:
          'Filter by LMS source (e.g. "blackboard", "canvas"). Omit for all.',
      },
    },
  },
  handler(args: { source?: string }) {
    const data = loadData();
    let courses = data.courses;
    if (args.source) {
      courses = courses.filter((c) => c.lmsSource === args.source);
    }
    if (courses.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No courses found. Make sure you've synced data by visiting your LMS with the extension installed.",
          },
        ],
      };
    }
    const text = courses
      .map((c) => `- **${c.name}** (${c.code})${c.term ? ` — ${c.term}` : ""}`)
      .join("\n");
    return {
      content: [
        { type: "text" as const, text: `Found ${courses.length} courses:\n\n${text}` },
      ],
    };
  },
};

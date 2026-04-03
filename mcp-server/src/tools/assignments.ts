import { loadData } from "../data.js";

export const lms_get_assignments = {
  name: "lms_get_assignments",
  description:
    "Get assignments, filterable by course, status, and date range. Returns assignment name, course, due date, status, and points.",
  inputSchema: {
    type: "object" as const,
    properties: {
      course: {
        type: "string",
        description: "Filter by course name (partial match, case-insensitive)",
      },
      status: {
        type: "string",
        enum: ["upcoming", "submitted", "graded", "missing", "unknown"],
        description: "Filter by assignment status",
      },
      from: {
        type: "string",
        description: "Start date (ISO 8601). Only return assignments due on or after this date.",
      },
      to: {
        type: "string",
        description: "End date (ISO 8601). Only return assignments due on or before this date.",
      },
    },
  },
  handler(args: { course?: string; status?: string; from?: string; to?: string }) {
    const data = loadData();
    let assignments = data.assignments;

    if (args.course) {
      const q = args.course.toLowerCase();
      assignments = assignments.filter(
        (a) =>
          a.courseName.toLowerCase().includes(q) ||
          a.courseId.toLowerCase().includes(q)
      );
    }
    if (args.status) {
      assignments = assignments.filter((a) => a.status === args.status);
    }
    if (args.from) {
      const from = new Date(args.from);
      assignments = assignments.filter((a) => a.dueDate && new Date(a.dueDate) >= from);
    }
    if (args.to) {
      const to = new Date(args.to);
      assignments = assignments.filter((a) => a.dueDate && new Date(a.dueDate) <= to);
    }

    // Sort by due date (soonest first), nulls last
    assignments.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    if (assignments.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No assignments found matching those filters." }],
      };
    }

    const text = assignments
      .map((a) => {
        const due = a.dueDate
          ? new Date(a.dueDate).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "No due date";
        const points =
          a.pointsEarned != null && a.pointsPossible != null
            ? ` (${a.pointsEarned}/${a.pointsPossible})`
            : a.pointsPossible != null
            ? ` (${a.pointsPossible} pts)`
            : "";
        return `- **${a.name}** — ${a.courseName}\n  Due: ${due} | Status: ${a.status}${points}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${assignments.length} assignments:\n\n${text}`,
        },
      ],
    };
  },
};

export const lms_get_upcoming = {
  name: "lms_get_upcoming",
  description:
    "Get assignments due in the next N days. Defaults to 7 days. Great for answering 'what do I have due this week?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      days: {
        type: "number",
        description: "Number of days to look ahead (default: 7)",
      },
      course: {
        type: "string",
        description: "Filter by course name (partial match, case-insensitive)",
      },
    },
  },
  handler(args: { days?: number; course?: string }) {
    const days = args.days ?? 7;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);

    return lms_get_assignments.handler({
      course: args.course,
      from: now.toISOString(),
      to: cutoff.toISOString(),
    });
  },
};

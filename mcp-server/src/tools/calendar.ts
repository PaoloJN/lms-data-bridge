import { loadData } from "../data.js";

export const lms_get_calendar = {
  name: "lms_get_calendar",
  description: "Get calendar events and deadlines within a date range.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description: "Start date (ISO 8601). Defaults to today.",
      },
      to: {
        type: "string",
        description: "End date (ISO 8601). Defaults to 30 days from now.",
      },
      course: {
        type: "string",
        description: "Filter by course name (partial match, case-insensitive)",
      },
    },
  },
  handler(args: { from?: string; to?: string; course?: string }) {
    const data = loadData();
    const from = args.from ? new Date(args.from) : new Date();
    const to = args.to
      ? new Date(args.to)
      : new Date(Date.now() + 30 * 86400000);

    let items = data.calendar.filter((item) => {
      const start = new Date(item.start);
      return start >= from && start <= to;
    });

    if (args.course) {
      const q = args.course.toLowerCase();
      items = items.filter((i) => i.courseName?.toLowerCase().includes(q));
    }

    items.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    if (items.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No calendar events found in that range." },
        ],
      };
    }

    const text = items
      .map((i) => {
        const date = new Date(i.start).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        const course = i.courseName ? ` — ${i.courseName}` : "";
        return `- **${i.title}**${course}\n  ${date} [${i.type}]`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${items.length} calendar events:\n\n${text}`,
        },
      ],
    };
  },
};

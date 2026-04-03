import { loadData } from "../data.js";

export const lms_get_grades = {
  name: "lms_get_grades",
  description:
    "Get grades. Can show all grades, filter by course, or show a course summary with average. Great for answering 'what's my grade in X?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      course: {
        type: "string",
        description: "Filter by course name (partial match, case-insensitive)",
      },
      summary: {
        type: "boolean",
        description:
          "If true, return per-course averages instead of individual grades. Default: false.",
      },
    },
  },
  handler(args: { course?: string; summary?: boolean }) {
    const data = loadData();
    let grades = data.grades;

    if (args.course) {
      const q = args.course.toLowerCase();
      grades = grades.filter((g) => g.courseName.toLowerCase().includes(q));
    }

    if (grades.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No grades found." }],
      };
    }

    if (args.summary) {
      // Group by course and compute averages
      const byCourse = new Map<
        string,
        { name: string; totalScore: number; totalPossible: number; count: number }
      >();
      for (const g of grades) {
        if (g.score == null || g.possible == null) continue;
        const entry = byCourse.get(g.courseId) ?? {
          name: g.courseName,
          totalScore: 0,
          totalPossible: 0,
          count: 0,
        };
        entry.totalScore += g.score;
        entry.totalPossible += g.possible;
        entry.count++;
        byCourse.set(g.courseId, entry);
      }

      const text = [...byCourse.values()]
        .map((c) => {
          const pct = ((c.totalScore / c.totalPossible) * 100).toFixed(1);
          return `- **${c.name}**: ${pct}% (${c.totalScore}/${c.totalPossible} across ${c.count} graded items)`;
        })
        .join("\n");

      return {
        content: [{ type: "text" as const, text: `Grade summary:\n\n${text}` }],
      };
    }

    // Individual grades
    const text = grades
      .map((g) => {
        const pct = g.percentage != null ? ` (${g.percentage.toFixed(1)}%)` : "";
        return `- **${g.assignmentName}** — ${g.courseName}: ${g.score}/${g.possible}${pct}`;
      })
      .join("\n");

    return {
      content: [
        { type: "text" as const, text: `Found ${grades.length} grades:\n\n${text}` },
      ],
    };
  },
};

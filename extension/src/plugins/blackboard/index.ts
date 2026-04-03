// Blackboard plugin — extracts data via direct REST API calls from content script
// Proven approach from canvas-task-extension: content scripts can fetch same-origin APIs

import type { LMSPlugin } from "../../schema/plugin";
import type {
  Course,
  Assignment,
  Grade,
  Announcement,
  CalendarItem,
  AssignmentStatus,
} from "../../schema/types";
import {
  getCourses,
  getGradebookColumns,
  getAttempts,
  getAnnouncements,
  type BBGradebookColumn,
  type BBAttempt,
} from "./api";

function now(): string {
  return new Date().toISOString();
}

function baseURL(): string {
  return window.location.protocol + "//" + window.location.host;
}

function inferStatus(col: BBGradebookColumn, attempt?: BBAttempt): AssignmentStatus {
  if (attempt?.displayGrade) return "graded";
  if (attempt?.status === "NeedsGrading") return "submitted";
  if (attempt?.status !== "NotAttempted" && attempt?.submissionDate) return "submitted";
  if (col.grading.due && new Date(col.grading.due) < new Date()) return "missing";
  if (col.grading.due) return "upcoming";
  return "unknown";
}

export const blackboardPlugin: LMSPlugin = {
  source: "blackboard",
  domainPatterns: ["*.blackboard.com"],

  canActivate(url: string): boolean {
    return /blackboard\.com/i.test(url);
  },

  async extractCourses(): Promise<Course[]> {
    const bbCourses = await getCourses();
    const synced = now();

    return bbCourses.map((c) => {
      const nameParts = c.name.split(": ");
      return {
        id: c.id,
        name: nameParts.length === 1 ? nameParts[0] : nameParts.slice(1).join(": "),
        code: nameParts[0],
        lmsSource: "blackboard" as const,
        lmsUrl: `${baseURL()}/ultra/courses/${c.id}/outline`,
        lastSynced: synced,
      };
    });
  },

  async extractAssignments(courses: Course[]): Promise<Assignment[]> {
    const synced = now();
    const assignments: Assignment[] = [];

    // Fetch gradebook columns for all courses in parallel
    const allColumns = await Promise.all(
      courses.map(async (course) => {
        try {
          const columns = await getGradebookColumns(course.id);
          return { course, columns };
        } catch {
          return { course, columns: [] as BBGradebookColumn[] };
        }
      })
    );

    // For each course, fetch attempts for each column to get submission status
    for (const { course, columns } of allColumns) {
      const attemptColumns = columns.filter((c) => c.grading.type === "Attempts");

      const withAttempts = await Promise.all(
        attemptColumns.map(async (col) => {
          try {
            const attempts = await getAttempts(course.id, col.id);
            return { col, attempt: attempts[0] };
          } catch {
            return { col, attempt: undefined };
          }
        })
      );

      for (const { col, attempt } of withAttempts) {
        // displayGrade.score is a percentage (0-100), col.score.possible is point value
        const possible = col.score?.possible;
        const pctScore = attempt?.displayGrade?.score;
        // Convert percentage to actual points: (pct/100) * possible
        const earned = (pctScore != null && possible != null) ? Math.round((pctScore / 100) * possible * 100) / 100 : undefined;

        assignments.push({
          id: `${course.id}_${col.id}`,
          courseId: course.id,
          courseName: course.name,
          name: col.name,
          dueDate: col.grading.due || undefined,
          status: inferStatus(col, attempt),
          pointsPossible: possible,
          pointsEarned: earned,
          lmsSource: "blackboard",
          lmsUrl: `${baseURL()}/ultra/courses/${course.id}/outline`,
          lastSynced: synced,
        });
      }
    }

    return assignments;
  },

  async extractGrades(courses: Course[]): Promise<Grade[]> {
    const synced = now();
    const grades: Grade[] = [];

    for (const course of courses) {
      try {
        const columns = await getGradebookColumns(course.id);
        for (const col of columns) {
          try {
            const attempts = await getAttempts(course.id, col.id);
            const attempt = attempts[0];
            if (attempt?.displayGrade && col.score?.possible) {
              // displayGrade.score is a percentage (0-100)
              const pct = attempt.displayGrade.score;
              const possible = col.score.possible;
              const earned = Math.round((pct / 100) * possible * 100) / 100;

              grades.push({
                courseId: course.id,
                courseName: course.name,
                assignmentId: `${course.id}_${col.id}`,
                assignmentName: col.name,
                score: earned,
                possible: possible,
                percentage: pct,
                lmsSource: "blackboard",
                lastSynced: synced,
              });
            }
          } catch {
            // Skip individual column errors
          }
        }
      } catch {
        // Skip inaccessible courses
      }
    }

    return grades;
  },

  async extractAnnouncements(courses: Course[]): Promise<Announcement[]> {
    const synced = now();
    const announcements: Announcement[] = [];

    const allAnnouncements = await Promise.all(
      courses.map(async (course) => {
        try {
          const bbAnnouncements = await getAnnouncements(course.id);
          return bbAnnouncements.map((a) => ({
            id: `${course.id}_${a.id}`,
            courseId: course.id,
            courseName: course.name,
            title: a.title,
            body: a.body ?? "",
            date: a.availability.duration.start,
            lmsSource: "blackboard" as const,
            lastSynced: synced,
          }));
        } catch {
          return [];
        }
      })
    );

    for (const batch of allAnnouncements) {
      announcements.push(...batch);
    }

    return announcements;
  },

  async extractCalendar(): Promise<CalendarItem[]> {
    // Calendar items are derived from assignments with due dates
    // No separate calendar endpoint needed for v1
    return [];
  },
};

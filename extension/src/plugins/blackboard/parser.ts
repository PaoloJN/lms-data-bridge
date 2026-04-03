// Parses intercepted Blackboard Ultra API responses into normalized schema types

import type {
  Course,
  Assignment,
  Grade,
  Announcement,
  CalendarItem,
  AssignmentStatus,
} from "../../schema/types";
import type { InterceptedResponse } from "./interceptor";

function now(): string {
  return new Date().toISOString();
}

// Parse course memberships response
// URL: /learn/api/public/v1/users/{userId}/courses
export function parseCourses(response: InterceptedResponse): Course[] {
  const body = response.body as { results?: Array<Record<string, unknown>> };
  if (!body?.results) return [];

  return body.results
    .filter((r: Record<string, unknown>) => {
      const avail = r.availability as { available?: string } | undefined;
      return avail?.available !== "No";
    })
    .map((r: Record<string, unknown>) => {
      const course = r.course as Record<string, unknown> | undefined;
      const term = r.term as { name?: string } | undefined;
      return {
        id: String(r.courseId ?? r.id ?? ""),
        name: String(course?.name ?? r.name ?? r.courseId ?? ""),
        code: String(course?.courseId ?? r.courseId ?? ""),
        term: term?.name,
        lmsSource: "blackboard" as const,
        lmsUrl: response.url.split("/learn/")[0] + `/ultra/courses/${r.courseId ?? r.id}/outline`,
        lastSynced: now(),
      };
    });
}

// Parse gradebook columns response
// URL: /learn/api/public/v1/courses/{courseId}/gradebook/columns
export function parseAssignments(
  response: InterceptedResponse,
  courseId: string,
  courseName: string
): Assignment[] {
  const body = response.body as { results?: Array<Record<string, unknown>> };
  if (!body?.results) return [];

  return body.results.map((col: Record<string, unknown>) => {
    const score = col.score as { possible?: number } | undefined;
    return {
      id: `${courseId}_${col.id}`,
      courseId,
      courseName,
      name: String(col.name ?? ""),
      description: col.description ? String(col.description) : undefined,
      dueDate: col.dueDate ? String(col.dueDate) : undefined,
      status: inferStatus(col),
      pointsPossible: score?.possible,
      lmsSource: "blackboard" as const,
      lastSynced: now(),
    };
  });
}

function inferStatus(col: Record<string, unknown>): AssignmentStatus {
  if (col.dueDate && new Date(String(col.dueDate)) < new Date()) return "missing";
  if (col.dueDate) return "upcoming";
  return "unknown";
}

// Parse grade for a specific column
// URL: /learn/api/public/v1/courses/{courseId}/gradebook/columns/{columnId}/users/{userId}
export function parseGrade(
  response: InterceptedResponse,
  courseId: string,
  courseName: string,
  columnName: string
): Grade | null {
  const body = response.body as Record<string, unknown>;
  if (body.score == null) return null;

  return {
    courseId,
    courseName,
    assignmentId: body.columnId ? `${courseId}_${body.columnId}` : undefined,
    assignmentName: columnName,
    score: Number(body.score),
    possible: undefined, // need column info for this
    percentage: undefined,
    lmsSource: "blackboard",
    lastSynced: now(),
  };
}

// Parse announcements response
// URL: /learn/api/public/v1/courses/{courseId}/announcements
export function parseAnnouncements(
  response: InterceptedResponse,
  courseId: string,
  courseName: string
): Announcement[] {
  const body = response.body as { results?: Array<Record<string, unknown>> };
  if (!body?.results) return [];

  return body.results.map((a: Record<string, unknown>) => ({
    id: `${courseId}_${a.id}`,
    courseId,
    courseName,
    title: String(a.title ?? ""),
    body: String(a.body ?? ""),
    date: String(a.created ?? a.modified ?? now()),
    lmsSource: "blackboard" as const,
    lastSynced: now(),
  }));
}

// Parse calendar items
// URL: /learn/api/public/v1/calendars/items
export function parseCalendar(response: InterceptedResponse): CalendarItem[] {
  const body = response.body as { results?: Array<Record<string, unknown>> };
  if (!body?.results) return [];

  return body.results.map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ""),
    courseId: item.calendarId ? String(item.calendarId) : undefined,
    title: String(item.title ?? ""),
    start: String(item.start ?? ""),
    end: item.end ? String(item.end) : undefined,
    type: "other" as const,
    lmsSource: "blackboard" as const,
    lastSynced: now(),
  }));
}

// Blackboard REST API client
// Direct fetch from content script context — uses same origin, session cookies sent automatically
// Based on proven approach from canvas-task-extension

function baseURL(): string {
  return window.location.protocol + "//" + window.location.host;
}

// Blackboard paginated response format
interface PaginatedResponse<T> {
  results: T[];
  paging?: { nextPage: string };
}

// Paginated fetch — follows nextPage links automatically
async function fetchPaginated<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blackboard API error: ${res.status} ${res.statusText} — ${url}`);
  const data = (await res.json()) as PaginatedResponse<T>;
  if (data.paging?.nextPage) {
    return data.results.concat(await fetchPaginated<T>(data.paging.nextPage));
  }
  return data.results;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blackboard API error: ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

// --- Raw Blackboard API types ---

export interface BBCalendar {
  id: string;
  name: string;
}

export interface BBGradebookColumn {
  id: string;
  contentId: string;
  name: string;
  score: { possible: number };
  grading: { due?: string; type: string };
  scoreProviderHandle?: string;
}

export interface BBAttempt {
  id: string;
  status: "NotAttempted" | "NeedsGrading" | "Completed";
  submissionDate?: string;
  displayGrade?: { score: number };
}

export interface BBAnnouncement {
  id: string;
  title: string;
  body?: string;
  availability: {
    duration: { start: string };
  };
}

export interface BBContentLink {
  links: { href: string; type: string }[];
}

// --- API functions ---

export async function getCourses(): Promise<BBCalendar[]> {
  const url = `${baseURL()}/learn/api/public/v1/calendars`;
  const results = await fetchPaginated<BBCalendar>(url);
  return results.filter((c) => c.id !== "INSTITUTION" && c.id !== "PERSONAL");
}

export async function getGradebookColumns(courseId: string): Promise<BBGradebookColumn[]> {
  const url = `${baseURL()}/learn/api/public/v2/courses/${courseId}/gradebook/columns`;
  return fetchPaginated<BBGradebookColumn>(url);
}

export async function getAttempts(courseId: string, columnId: string): Promise<BBAttempt[]> {
  const url = `${baseURL()}/learn/api/public/v2/courses/${courseId}/gradebook/columns/${columnId}/attempts`;
  return fetchPaginated<BBAttempt>(url);
}

export async function getAnnouncements(courseId: string): Promise<BBAnnouncement[]> {
  const url = `${baseURL()}/learn/api/public/v1/courses/${courseId}/announcements`;
  return fetchPaginated<BBAnnouncement>(url);
}

export async function getContentLink(courseId: string, contentId: string): Promise<BBContentLink> {
  const url = `${baseURL()}/learn/api/public/v1/courses/${courseId}/contents/${contentId}?fields=links`;
  return fetchJSON<BBContentLink>(url);
}

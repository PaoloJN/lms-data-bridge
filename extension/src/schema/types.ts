// Common normalized data types shared across all LMS plugins

export type LMSSource = "blackboard" | "canvas" | "brightspace" | "moodle";

export interface Course {
  id: string;
  name: string;
  code: string;
  term?: string;
  instructor?: string;
  lmsSource: LMSSource;
  lmsUrl: string;
  lastSynced: string; // ISO 8601
}

export type AssignmentStatus = "upcoming" | "submitted" | "graded" | "missing" | "unknown";

export interface Assignment {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  description?: string;
  dueDate?: string; // ISO 8601
  status: AssignmentStatus;
  pointsPossible?: number;
  pointsEarned?: number;
  lmsSource: LMSSource;
  lmsUrl?: string;
  lastSynced: string;
}

export interface Grade {
  courseId: string;
  courseName: string;
  assignmentId?: string;
  assignmentName?: string;
  score?: number;
  possible?: number;
  percentage?: number;
  letter?: string;
  lmsSource: LMSSource;
  lastSynced: string;
}

export interface Announcement {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  body: string;
  date: string; // ISO 8601
  lmsSource: LMSSource;
  lastSynced: string;
}

export interface CalendarItem {
  id: string;
  courseId?: string;
  courseName?: string;
  title: string;
  start: string; // ISO 8601
  end?: string;
  type: "assignment" | "exam" | "event" | "other";
  lmsSource: LMSSource;
  lastSynced: string;
}

// The full data store written to disk
export interface LMSDataStore {
  version: 1;
  lastSynced: string;
  sources: LMSSource[];
  courses: Course[];
  assignments: Assignment[];
  grades: Grade[];
  announcements: Announcement[];
  calendar: CalendarItem[];
}

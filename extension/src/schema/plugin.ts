import type {
  LMSSource,
  Course,
  Assignment,
  Grade,
  Announcement,
  CalendarItem,
} from "./types";

// Every LMS plugin must implement this interface
export interface LMSPlugin {
  source: LMSSource;

  // Domain patterns this plugin handles (e.g. ["*.blackboard.com"])
  domainPatterns: string[];

  // Check if this plugin can extract data from the current page
  canActivate(url: string): boolean;

  // Extract all data — called by the content script when the plugin is active
  extractCourses(): Promise<Course[]>;
  extractAssignments(courses: Course[]): Promise<Assignment[]>;
  extractGrades(courses: Course[]): Promise<Grade[]>;
  extractAnnouncements(courses: Course[]): Promise<Announcement[]>;
  extractCalendar(courses: Course[]): Promise<CalendarItem[]>;
}

// Plugin registry
const plugins: LMSPlugin[] = [];

export function registerPlugin(plugin: LMSPlugin) {
  plugins.push(plugin);
}

export function getPluginForUrl(url: string): LMSPlugin | null {
  return plugins.find((p) => p.canActivate(url)) ?? null;
}

export function getAllPlugins(): LMSPlugin[] {
  return [...plugins];
}

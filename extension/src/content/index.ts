// Content script — runs on LMS pages, extracts data via direct API calls, saves to storage

import { registerPlugin, getPluginForUrl } from "../schema/plugin";
import { blackboardPlugin } from "../plugins/blackboard/index";
import type { LMSDataStore } from "../schema/types";

// Register all plugins
registerPlugin(blackboardPlugin);

async function syncData() {
  const plugin = getPluginForUrl(window.location.href);
  if (!plugin) return;

  console.log(`[LMS Bridge] Detected ${plugin.source}, starting sync...`);

  try {
    const courses = await plugin.extractCourses();
    console.log(`[LMS Bridge] Found ${courses.length} courses`);

    // Extract all data in parallel
    const [assignments, grades, announcements, calendar] = await Promise.all([
      plugin.extractAssignments(courses),
      plugin.extractGrades(courses),
      plugin.extractAnnouncements(courses),
      plugin.extractCalendar(courses),
    ]);

    const store: LMSDataStore = {
      version: 1,
      lastSynced: new Date().toISOString(),
      sources: [plugin.source],
      courses,
      assignments,
      grades,
      announcements,
      calendar,
    };

    // Save to chrome.storage.local
    await chrome.storage.local.set({ lmsData: store });

    // Tell the background worker to export to disk
    chrome.runtime.sendMessage({ type: "SYNC_COMPLETE", data: store });

    console.log(
      `[LMS Bridge] Sync complete: ${courses.length} courses, ` +
      `${assignments.length} assignments, ${grades.length} grades, ` +
      `${announcements.length} announcements`
    );
  } catch (err) {
    console.error("[LMS Bridge] Sync failed:", err);
  }
}

// Sync when the page loads
syncData();

// Re-sync when navigating within the SPA (Blackboard Ultra is a single-page app)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Debounce — wait for the page to settle
    setTimeout(syncData, 2000);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

console.log("[LMS Bridge] Content script loaded on", window.location.hostname);

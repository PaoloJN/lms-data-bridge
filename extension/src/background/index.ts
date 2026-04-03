// Background service worker — coordinates sync and exports data via HTTP to MCP server

const SYNC_URL = "http://127.0.0.1:7890/sync";

// Listen for sync completion from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_COMPLETE") {
    exportToServer(message.data);
    updateBadge("ok");
    sendResponse({ status: "ok" });
  }

  if (message.type === "GET_SYNC_STATUS") {
    chrome.storage.local.get("lmsData", (result) => {
      const data = result.lmsData;
      if (!data) {
        sendResponse({ hasSynced: false });
        return;
      }

      // Detect current term from course codes (YYYYTT pattern)
      const termCodes = new Set<string>();
      for (const c of data.courses ?? []) {
        const m = (c.code || c.name || "").match(/(20\d{2})(10|20|24|30)/);
        if (m) termCodes.add(m[1] + m[2]);
      }
      const currentTermCode = [...termCodes].sort().pop() ?? null;

      // Filter courses to current term
      const currentCourseIds = new Set<string>();
      for (const c of data.courses ?? []) {
        const m = (c.code || c.name || "").match(/(20\d{2})(10|20|24|30)/);
        if (!m || m[1] + m[2] === currentTermCode) currentCourseIds.add(c.id);
      }
      const currentCourses = (data.courses ?? []).filter(
        (c: Record<string, unknown>) => currentCourseIds.has(c.id as string)
      );

      // Upcoming assignments (next 7 days, not graded/submitted, current term)
      const now = Date.now();
      const weekOut = now + 7 * 86400000;
      const upcoming = (data.assignments ?? [])
        .filter((a: Record<string, unknown>) => {
          if (!a.dueDate) return false;
          if (!currentCourseIds.has(a.courseId as string)) return false;
          const due = new Date(a.dueDate as string).getTime();
          return due >= now && due <= weekOut && a.status !== "graded" && a.status !== "submitted";
        })
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime()
        )
        .slice(0, 5);

      // Missing count (current term only)
      const missing = (data.assignments ?? []).filter(
        (a: Record<string, unknown>) => a.status === "missing" && currentCourseIds.has(a.courseId as string)
      ).length;

      sendResponse({
        hasSynced: true,
        lastSynced: data.lastSynced ?? null,
        courseCount: currentCourses.length,
        assignmentCount: (data.assignments ?? []).filter(
          (a: Record<string, unknown>) => currentCourseIds.has(a.courseId as string)
        ).length,
        upcoming,
        missing,
      });
    });
    return true;
  }
});

// Export data to MCP server via HTTP POST
async function exportToServer(data: unknown) {
  try {
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    console.log("[LMS Bridge] Data synced to MCP server:", result);
  } catch {
    console.warn(
      "[LMS Bridge] MCP server not running. Data saved to chrome.storage.local only.",
      "Start the server: cd mcp-server && npm run dev"
    );
  }
}

function updateBadge(status: "ok" | "error") {
  const color = status === "ok" ? "#22c55e" : "#ef4444";
  const text = status === "ok" ? "✓" : "!";
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[LMS Bridge] Extension installed. Visit your LMS to sync data.");
});

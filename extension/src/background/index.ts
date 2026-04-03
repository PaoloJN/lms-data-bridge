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
      sendResponse({
        hasSynced: !!result.lmsData,
        lastSynced: result.lmsData?.lastSynced ?? null,
        courseCount: result.lmsData?.courses?.length ?? 0,
        assignmentCount: result.lmsData?.assignments?.length ?? 0,
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

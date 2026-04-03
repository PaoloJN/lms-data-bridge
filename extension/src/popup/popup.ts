const serverEl = document.getElementById("server-status")!;
const syncEl = document.getElementById("sync-status")!;

// Check MCP server status
fetch("http://127.0.0.1:7890/status")
  .then((res) => res.json())
  .then((data) => {
    serverEl.innerHTML = `
      <div class="status server-ok">
        <strong>MCP Server: Connected</strong>
      </div>
    `;
  })
  .catch(() => {
    serverEl.innerHTML = `
      <div class="status server-off">
        <strong>MCP Server: Not running</strong>
      </div>
      <p class="hint">Start it: cd mcp-server && npm run dev</p>
    `;
  });

// Check extension sync status
chrome.runtime.sendMessage({ type: "GET_SYNC_STATUS" }, (response) => {
  if (!response?.hasSynced) {
    syncEl.innerHTML = `
      <div class="status not-synced">
        <strong>Not synced yet</strong>
      </div>
      <p class="hint">Visit your Blackboard to start syncing data.</p>
    `;
    return;
  }

  const lastSynced = new Date(response.lastSynced);
  const timeAgo = getTimeAgo(lastSynced);

  syncEl.innerHTML = `
    <div class="status synced">
      <strong>Synced</strong> ${timeAgo}
    </div>
    <div class="stat">
      <span class="label">Courses</span>
      <span class="value">${response.courseCount}</span>
    </div>
    <div class="stat">
      <span class="label">Assignments</span>
      <span class="value">${response.assignmentCount}</span>
    </div>
  `;
});

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

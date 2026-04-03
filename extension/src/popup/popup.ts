const connectionEl = document.getElementById("connection")!;
const contentEl = document.getElementById("content")!;

interface UpcomingAssignment {
  name: string;
  courseName: string;
  dueDate: string;
  pointsPossible?: number;
}

interface GradeSummary {
  name: string;
  pct: number;
}

interface SyncStatus {
  hasSynced: boolean;
  lastSynced: string | null;
  courseCount: number;
  assignmentCount: number;
  gradeCount: number;
  upcoming: UpcomingAssignment[];
  grades: GradeSummary[];
  missing: number;
}

// Check MCP server connection
fetch("http://127.0.0.1:7890/status")
  .then(() => {
    connectionEl.innerHTML = `<span class="dot green"></span> MCP connected`;
  })
  .catch(() => {
    connectionEl.innerHTML = `<span class="dot red"></span> MCP offline`;
  });

// Load data
chrome.runtime.sendMessage({ type: "GET_SYNC_STATUS" }, (response: SyncStatus) => {
  if (!response?.hasSynced) {
    contentEl.innerHTML = `
      <div class="empty">
        <p>No data yet</p>
        <p style="margin-top:6px">Visit your Blackboard to sync.</p>
      </div>
    `;
    return;
  }

  let html = "";


  // Upcoming assignments
  if (response.upcoming.length > 0) {
    html += `<div class="section">
      <div class="section-title">Due This Week</div>`;
    for (const a of response.upcoming) {
      const due = formatDue(a.dueDate);
      const course = cleanCourse(a.courseName);
      html += `
        <div class="assignment-item">
          <div>
            <div class="assignment-name">${esc(a.name)}</div>
            <div class="assignment-course">${esc(course)}</div>
          </div>
          <div class="assignment-due ${due.cls}">${due.text}</div>
        </div>`;
    }
    html += `</div>`;
  }


  // Synced footer
  const ago = getTimeAgo(new Date(response.lastSynced!));
  html += `<div class="footer">Synced ${ago}</div>`;

  contentEl.innerHTML = html;
});

function cleanCourse(name: string): string {
  const m = name.match(/([A-Z]{2,5})[\s\-_]?(\d{3}[A-Z]?)/i);
  if (m) return `${m[1]} ${m[2]}`.toUpperCase();
  const c = name.match(/^([A-Z]{2,5}\s+\d{3})/i);
  if (c) return c[1].toUpperCase();
  return name;
}

function formatDue(iso: string): { text: string; cls: string } {
  const d = new Date(iso);
  const now = new Date();
  const diffH = (d.getTime() - now.getTime()) / 3600000;
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (diffH < 0) return { text: "Overdue", cls: "urgent" };
  if (diffH < 24) return { text: `Today ${time}`, cls: "urgent" };
  if (diffH < 48) return { text: `Tomorrow ${time}`, cls: "soon" };
  return { text: `${day} ${time}`, cls: "" };
}

function getTimeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function esc(str: string): string {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

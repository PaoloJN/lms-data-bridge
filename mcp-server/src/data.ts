// Data layer — reads/writes LMS data, serves HTTP sync endpoint for the extension

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createServer, IncomingMessage, ServerResponse } from "http";

const DATA_DIR = join(homedir(), ".lms-bridge");
const DATA_FILE = join(DATA_DIR, "data.json");
const HTTP_PORT = parseInt(process.env.LMS_BRIDGE_PORT || "7890", 10);

// --- Types ---

export interface LMSDataStore {
  version: number;
  lastSynced: string;
  sources: string[];
  courses: Course[];
  assignments: Assignment[];
  grades: Grade[];
  announcements: Announcement[];
  calendar: CalendarItem[];
}

export interface Course {
  id: string;
  name: string;
  code: string;
  term?: string;
  instructor?: string;
  lmsSource: string;
  lmsUrl: string;
  lastSynced: string;
}

export interface Assignment {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  description?: string;
  dueDate?: string;
  status: string;
  pointsPossible?: number;
  pointsEarned?: number;
  lmsSource: string;
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
  lmsSource: string;
  lastSynced: string;
}

export interface Announcement {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  body: string;
  date: string;
  lmsSource: string;
  lastSynced: string;
}

export interface CalendarItem {
  id: string;
  courseId?: string;
  courseName?: string;
  title: string;
  start: string;
  end?: string;
  type: string;
  lmsSource: string;
  lastSynced: string;
}

// --- In-memory cache ---

let cache: LMSDataStore | null = null;

function emptyStore(): LMSDataStore {
  return {
    version: 1,
    lastSynced: "",
    sources: [],
    courses: [],
    assignments: [],
    grades: [],
    announcements: [],
    calendar: [],
  };
}

export function loadData(): LMSDataStore {
  if (cache) return cache;
  if (!existsSync(DATA_FILE)) return emptyStore();
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    cache = JSON.parse(raw) as LMSDataStore;
    return cache;
  } catch {
    return emptyStore();
  }
}

export function setData(store: LMSDataStore): void {
  cache = store;
  // Write to disk atomically
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = DATA_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmpFile, DATA_FILE);
}

export function getDataAge(): { file: string; exists: boolean; ageMinutes: number | null } {
  const data = loadData();
  if (!data.lastSynced) {
    return { file: DATA_FILE, exists: existsSync(DATA_FILE), ageMinutes: null };
  }
  const age = (Date.now() - new Date(data.lastSynced).getTime()) / 60000;
  return { file: DATA_FILE, exists: true, ageMinutes: Math.round(age) };
}

// --- HTTP server for extension sync ---

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function startHttpServer(): void {
  const server = createServer(async (req, res) => {
    setCors(res);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sync — receive data from extension
    if (req.method === "POST" && req.url === "/sync") {
      try {
        const body = await readBody(req);
        const store = JSON.parse(body) as LMSDataStore;
        setData(store);
        const summary = {
          status: "ok",
          courses: store.courses.length,
          assignments: store.assignments.length,
          grades: store.grades.length,
          announcements: store.announcements.length,
        };
        console.error(`[LMS Bridge HTTP] Synced: ${JSON.stringify(summary)}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        console.error("[LMS Bridge HTTP] Sync error:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: String(err) }));
      }
      return;
    }

    // GET /status — health check for extension popup
    if (req.method === "GET" && req.url === "/status") {
      const info = getDataAge();
      const data = loadData();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        lastSynced: data.lastSynced || null,
        courses: data.courses?.length ?? 0,
        assignments: data.assignments?.length ?? 0,
        ageMinutes: info.ageMinutes,
      }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(HTTP_PORT, "127.0.0.1", () => {
    console.error(`[LMS Bridge HTTP] Listening on http://127.0.0.1:${HTTP_PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[LMS Bridge HTTP] Port ${HTTP_PORT} already in use. HTTP sync disabled.`);
    } else {
      console.error("[LMS Bridge HTTP] Server error:", err);
    }
  });
}

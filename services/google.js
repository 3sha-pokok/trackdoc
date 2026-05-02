// services/google.js  (CLEAN + WORKING ESM VERSION)
// REQUIREMENT: package.json must include:  { "type": "module" }
// (or rename this file to google.mjs and update imports)

import { google } from "googleapis";

/* ==============================
   OAuth Client
================================ */
export function getOAuth2Client(tokens = null) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI
  );
  if (tokens) client.setCredentials(tokens);
  return client;
}

/* ==============================
   Google Login URL
================================ */
export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ],
  });
}

/* ==============================
   Extract Google Doc ID
================================ */
export function extractDocId(url = "") {
  const match = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/* ==============================
   Fetch File Metadata (Drive v3)
================================ */
export async function fetchFileMeta(tokens, fileId) {
  const auth = getOAuth2Client(tokens);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });

  return res.data;
}

/* ==============================
   Fetch File Security Meta
================================ */
export async function fetchFileSecurityMeta(tokens, fileId) {
  const auth = getOAuth2Client(tokens);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.get({
    fileId,
    fields: [
      "id",
      "name",
      "mimeType",
      "createdTime",
      "modifiedTime",
      "owners(displayName,emailAddress)",
      "shared",
      "writersCanShare",
      "copyRequiresWriterPermission",
      "permissions(type,role,emailAddress,domain,allowFileDiscovery)",
    ].join(","),
    supportsAllDrives: true,
  });

  return res.data;
}

/* ==============================
   Fetch Revision Metadata (Drive v3)
================================ */
export async function fetchRevisions(tokens, documentId) {
  const auth = getOAuth2Client(tokens);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.revisions.list({
    fileId: documentId,
    fields:
      "revisions(id, modifiedTime, lastModifyingUser(displayName,emailAddress))",
    supportsAllDrives: true,
  });

  return res.data.revisions || [];
}

/* ==============================
   Fetch CURRENT Document (Docs v1)
================================ */
export async function fetchDocumentContent(tokens, documentId) {
  const auth = getOAuth2Client(tokens);
  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({ documentId });
  return res.data;
}

/* ==============================
   Export CURRENT Document as text/plain
================================ */
export async function exportCurrentDocText(tokens, documentId) {
  const auth = getOAuth2Client(tokens);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.export(
    { fileId: documentId, mimeType: "text/plain" },
    { responseType: "text" }
  );

  return res.data;
}

/* ==============================
   Download a SPECIFIC revision’s content
   (uploaded/binary files ONLY)
================================ */
export async function getRevisionContent(tokens, fileId, revisionId) {
  const auth = getOAuth2Client(tokens);
  const drive = google.drive({ version: "v3", auth });

  const meta = await drive.files.get({
    fileId,
    fields: "id,mimeType,name",
    supportsAllDrives: true,
  });

  if (meta.data.mimeType === "application/vnd.google-apps.document") return null;

  const res = await drive.revisions.get(
    {
      fileId,
      revisionId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data);
}

/* ==============================
   Render Doc → HTML (Preview)
================================ */
export function renderDocumentToHTML(doc) {
  if (!doc?.body?.content) return "";

  let html = "";
  for (const block of doc.body.content) {
    if (!block.paragraph) continue;

    const text = (block.paragraph.elements || [])
      .map((el) => el.textRun?.content || "")
      .join("");

    if (text.trim()) html += `<p>${escapeHtml(text)}</p>`;
  }
  return html;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ==============================
   Extract User Actions
   - whenISO only
   - strict Unknown normalization (fixes "0 unknown" bug)
================================ */
export function extractUserActions(revisions) {
  const sorted = [...(revisions || [])].sort(
    (a, b) => new Date(a.modifiedTime) - new Date(b.modifiedTime)
  );

  const actions = [];

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = sorted[i - 1];

    const whoRaw =
      curr.lastModifyingUser?.displayName ||
      curr.lastModifyingUser?.emailAddress ||
      "";

    const who = String(whoRaw).trim() || "Unknown";

    let action = "Edited document";
    if (i === 0) action = "Document created";
    else if (
      (curr.lastModifyingUser?.emailAddress || "") !==
      (prev?.lastModifyingUser?.emailAddress || "")
    ) {
      action = "Edited document (collaboration)";
    }

    actions.push({
      who,
      action,
      whenISO: curr.modifiedTime,
      revisionId: curr.id,
    });
  }

  return actions;
}

/* ==============================
   Group Actions by User
   - Unknown kept
   - Keys ordered A–Z, Unknown last
================================ */
export function groupRevisionsByUser(revisions) {
  const actions = extractUserActions(revisions);
  const grouped = {};

  for (const a of actions) {
    const key = String(a.who).trim() || "Unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  }

  for (const user of Object.keys(grouped)) {
    grouped[user].sort((x, y) => new Date(x.whenISO) - new Date(y.whenISO));
  }

  const ordered = {};
  Object.keys(grouped)
    .sort((a, b) => {
      const ax = String(a || "").trim();
      const bx = String(b || "").trim();
      const aU = ax.toLowerCase() === "unknown";
      const bU = bx.toLowerCase() === "unknown";
      if (aU && !bU) return 1;
      if (!aU && bU) return -1;
      return ax.localeCompare(bx, undefined, { sensitivity: "base" });
    })
    .forEach((k) => (ordered[k] = grouped[k]));

  return ordered;
}

/* ==============================
   Summary Builder
   - contributors includes Unknown
================================ */
export function buildSummary(revisions) {
  const actions = extractUserActions(revisions);
  const unique = new Set(actions.map((a) => String(a.who).trim() || "Unknown"));
  return {
    totalActions: actions.length,
    contributors: unique.size,
  };
}

/* ==============================
   Behavioural Forensics Engine
   REQUIRED CHANGES:
   - No burst edits
   - No avgGapMinutes
   - Any Unknown action => +30 immediately
   - UnknownActions/UnknownShare always consistent
================================ */
export function analyseForensics(revisions) {
  if (!revisions || revisions.length === 0) return null;

  const sorted = [...revisions].sort(
    (a, b) => new Date(a.modifiedTime) - new Date(b.modifiedTime)
  );

  const totalActions = sorted.length;

  const byUser = {};
  let unknownActions = 0;

  let editorSwitches = 0;
  let lastEditor = null;

  let afterHoursEdits = 0;
  const hourStart = 8;
  const hourEnd = 20;

  const usersSeen = new Set();
  let lateNewEditors = 0;
  const lateThresholdIndex = Math.floor(sorted.length * 0.75);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];

    const raw =
      r.lastModifyingUser?.displayName ||
      r.lastModifyingUser?.emailAddress ||
      "";

    const who = String(raw).trim() || "Unknown";
    const isUnknown = who.toLowerCase() === "unknown";

    if (isUnknown) unknownActions++;

    const dt = new Date(r.modifiedTime);
    const time = dt.getTime();
    const hour = dt.getHours();

    if (!byUser[who]) byUser[who] = [];
    byUser[who].push(time);

    if (hour < hourStart || hour >= hourEnd) afterHoursEdits++;

    if (lastEditor && lastEditor !== who) editorSwitches++;
    lastEditor = who;

    if (!usersSeen.has(who)) {
      usersSeen.add(who);
      if (sorted.length >= 8 && i >= lateThresholdIndex) lateNewEditors++;
    }
  }

  const perUserCounts = Object.entries(byUser).map(([user, times]) => ({
    user,
    count: times.length,
  }));
  perUserCounts.sort((a, b) => b.count - a.count);

  const primaryEditor = perUserCounts[0]?.user || "Unknown";
  const primaryCount = perUserCounts[0]?.count || 0;
  const secondCount = perUserCounts[1]?.count || 0;

  const primaryShare = totalActions ? primaryCount / totalActions : 0;
  const top2Share = totalActions
    ? (primaryCount + secondCount) / totalActions
    : 0;

  const collaborators = Object.keys(byUser).length;

  const unknownShare = totalActions ? unknownActions / totalActions : 0;
  const afterHoursRate = totalActions ? afterHoursEdits / totalActions : 0;

  let riskScore = 0;

  // 1) Unknown identity: ANY unknown action => +30 immediately
  if (unknownActions > 0) riskScore += 30;

  // 2) After-hours (0–15)
  if (afterHoursRate > 0.6) riskScore += 15;
  else if (afterHoursRate >= 0.3) riskScore += 8;

  // 3) Editor switching (0–15)
  if (editorSwitches >= 10) riskScore += 15;
  else if (editorSwitches >= 5) riskScore += 8;
  else if (editorSwitches >= 2) riskScore += 4;

  // 4) Contributor surface (0–10)
  if (collaborators >= 6) riskScore += 10;
  else if (collaborators >= 3) riskScore += 6;
  else if (collaborators === 2) riskScore += 2;

  // 5) Dominance (0–15) only when collaborators >= 3
  if (collaborators >= 3) {
    if (primaryShare > 0.9) riskScore += 15;
    else if (primaryShare >= 0.8) riskScore += 8;
    if (top2Share > 0.95) riskScore += 5;
  }

  // 6) Late new editors (0–20)
  if (lateNewEditors >= 2) riskScore += 20;
  else if (lateNewEditors === 1) riskScore += 10;

  riskScore = Math.min(100, Math.max(0, Math.round(riskScore)));

  let riskLevel = "Low";
  if (riskScore >= 75) riskLevel = "Critical";
  else if (riskScore >= 50) riskLevel = "High";
  else if (riskScore >= 25) riskLevel = "Medium";

  const behaviour = Object.entries(byUser)
    .map(([user, times]) => ({
      user,
      actions: times.length,
      percentage: Math.round((times.length / totalActions) * 100),
    }))
    .sort((a, b) => {
      const ax = a.user.toLowerCase();
      const bx = b.user.toLowerCase();
      const aU = ax === "unknown";
      const bU = bx === "unknown";
      if (aU && !bU) return 1;
      if (!aU && bU) return -1;
      return a.user.localeCompare(b.user, undefined, { sensitivity: "base" });
    });

  return {
    primaryEditor,
    primaryShare,
    top2Share,
    collaborators,
    editorSwitches,
    lateNewEditors,
    afterHoursEdits,
    afterHoursRate,
    unknownActions,
    unknownShare,
    riskScore,
    riskLevel,
    behaviour,
  };
}

/* ==============================
   Document Criticality Engine
================================ */
export function analyseCriticality(fileMeta) {
  if (!fileMeta) {
    return { criticalityScore: 0, criticalityLevel: "Low", factors: [] };
  }

  let score = 0;
  const factors = [];

  const owners = fileMeta.owners || [];
  const ownerDomain =
    owners[0]?.emailAddress?.split("@")[1]?.toLowerCase() || null;

  const perms = fileMeta.permissions || [];
  const anyonePerm = perms.find((p) => p.type === "anyone");
  const domainPerms = perms.filter((p) => p.type === "domain");
  const userPerms = perms.filter((p) => p.type === "user");

  if (anyonePerm) {
    if (anyonePerm.allowFileDiscovery) {
      score += 50;
      factors.push("Public on web (discoverable)");
    } else {
      score += 35;
      factors.push("Anyone with link");
    }

    if (anyonePerm.role === "writer") {
      score += 40;
      factors.push("Public can edit");
    } else if (anyonePerm.role === "commenter") {
      score += 20;
      factors.push("Public can comment");
    }
  }

  if (domainPerms.length) {
    score += 15;
    factors.push("Domain-wide access");
  }

  if (ownerDomain) {
    const externalUsers = userPerms.filter((p) => {
      const d = (p.emailAddress || "").split("@")[1]?.toLowerCase();
      return d && d !== ownerDomain;
    });

    if (externalUsers.length) {
      score += Math.min(25, externalUsers.length * 10);
      factors.push(`External collaborators: ${externalUsers.length}`);
    }
  }

  const writers = perms.filter((p) => p.role === "writer").length;
  if (writers >= 3) {
    score += 10;
    factors.push(`Many writers: ${writers}`);
  } else if (writers === 2) {
    score += 5;
    factors.push("Multiple writers");
  }

  if (fileMeta.writersCanShare) {
    score += 10;
    factors.push("Writers can share");
  }
  if (fileMeta.copyRequiresWriterPermission === false) {
    score += 10;
    factors.push("Copy less restricted");
  }

  const name = (fileMeta.name || "").toLowerCase();
  const keywords = [
    "confidential",
    "salary",
    "payroll",
    "finance",
    "invoice",
    "bank",
    "contract",
    "agreement",
    "legal",
    "hr",
    "employee",
    "exam",
    "result",
    "password",
    "credential",
    "secret",
    "audit",
  ];
  const hit = keywords.filter((k) => name.includes(k));
  if (hit.length) {
    score += Math.min(25, hit.length * 8);
    factors.push(`Sensitive title keywords: ${hit.join(", ")}`);
  }

  score = Math.min(100, Math.round(score));

  let level = "Low";
  if (score >= 75) level = "Critical";
  else if (score >= 50) level = "High";
  else if (score >= 25) level = "Medium";

  return { criticalityScore: score, criticalityLevel: level, factors };
}

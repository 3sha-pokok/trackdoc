// routes/docs.js  (FIXED: diffSupported always defined + safer mime checks)
import express from "express";
import PDFDocument from "pdfkit";
import { diffWords } from "diff";

import {
  fetchRevisions,
  fetchDocumentContent,
  renderDocumentToHTML,
  groupRevisionsByUser,
  buildSummary,
  extractUserActions,
  extractDocId,
  analyseForensics,
  fetchFileMeta,
  getRevisionContent,
  exportCurrentDocText,
} from "../services/google.js";
import { saveSnapshot, getSnapshot } from "../services/snapshots.js";
import { calculateDiff } from "../services/forensics.js";

const router = express.Router();

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/* ------------------------------
   Submit Page
-------------------------------- */
router.get("/submit", (req, res) => {
  if (!req.session.tokens) return res.redirect("/");
  res.render("submit");
});

/* ------------------------------
   Process Doc URL
-------------------------------- */
router.post("/process", (req, res) => {
  if (!req.session.tokens) return res.redirect("/");

  const docId = extractDocId(req.body.docUrl);
  if (!docId) return res.redirect("/docs/submit");

  req.session.documentId = docId;
  res.redirect("/docs/report");
});

/* ------------------------------
   Dashboard / Report
-------------------------------- */
router.get("/report", async (req, res) => {
  if (!req.session.tokens || !req.session.documentId) {
    return res.redirect("/docs/submit");
  }

  const { tokens, documentId } = req.session;

  try {
    // Always define this so EJS never throws
    let diffSupported = false;

    // Best-effort: determine MIME
    try {
      const meta = await fetchFileMeta(tokens, documentId);
      // Diff is now supported for Google Docs via our snapshot system
      diffSupported = true;
    } catch {
      diffSupported = false;
    }

    const revisions = await fetchRevisions(tokens, documentId);

    const activities = extractUserActions(revisions);
    const grouped = groupRevisionsByUser(revisions);
    const summary = buildSummary(revisions);

    const forensics = analyseForensics(revisions);

    const docContent = await fetchDocumentContent(tokens, documentId);
    const docHtml = renderDocumentToHTML(docContent);

    // Snapshot current state for future diffs
    try {
      const revisions = await fetchRevisions(tokens, documentId);
      const latestRev = revisions[revisions.length - 1];
      if (latestRev) {
        const currentText = await exportCurrentDocText(tokens, documentId);
        await saveSnapshot(documentId, latestRev.id, currentText);
      }
    } catch (snapErr) {
      console.error("[SNAPSHOT] Failed to save current state:", snapErr.message);
    }

    res.render("dashboard", {
      userEmail: req.session.userEmail || "Signed in with Google",
      documentId,
      diffSupported,
      docEmbedUrl: `https://docs.google.com/document/d/${documentId}/preview`,
      docOpenUrl: `https://docs.google.com/document/d/${documentId}/edit`,
      grouped,
      activities,
      summary,
      forensics,
      docHtml,
    });
  } catch (err) {
    console.error("[REPORT] Failed:", err?.response?.data || err?.message || err);
    res.status(500).send("Failed to generate report");
  }
});

/* ------------------------------
   Revision "diff" endpoint
-------------------------------- */
router.get("/diff/:fileId/:currentRevId/:previousRevId", async (req, res) => {
  try {
    const tokens = req.session.tokens;
    if (!tokens) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { fileId, currentRevId, previousRevId } = req.params;

    const meta = await fetchFileMeta(tokens, fileId);
    if (meta?.mimeType === GOOGLE_DOC_MIME) {
      // Use Snapshot system for Google Docs
      const currentText = await getSnapshot(fileId, currentRevId);
      const previousText = previousRevId && previousRevId !== "initial"
        ? await getSnapshot(fileId, previousRevId)
        : "";

      if (!currentText) {
        return res.json({
          success: false,
          supported: false,
          reason: "Snapshot for this revision is not available. Please refresh the report to capture the current state.",
        });
      }

      const diffResult = calculateDiff(previousText || "", currentText);
      return res.json({
        success: true,
        supported: true,
        changes: diffResult.changes,
        summary: diffResult.summary
      });
    }

    const currentBuf = await getRevisionContent(tokens, fileId, currentRevId);
    if (!currentBuf) {
      return res.json({
        success: false,
        supported: false,
        reason: "Revision content unavailable.",
      });
    }

    const currentText = currentBuf.toString("utf8");

    let previousText = "";
    if (previousRevId && previousRevId !== "initial") {
      const prevBuf = await getRevisionContent(tokens, fileId, previousRevId);
      previousText = prevBuf ? prevBuf.toString("utf8") : "";
    }

    const changes = diffWords(previousText, currentText);
    return res.json({ success: true, supported: true, changes });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/* ------------------------------
   Export PDF
-------------------------------- */
router.get("/export/pdf", async (req, res) => {
  if (!req.session.tokens || !req.session.documentId) {
    return res.redirect("/");
  }

  try {
    const revisions = await fetchRevisions(
      req.session.tokens,
      req.session.documentId
    );

    const activities = extractUserActions(revisions);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=trackdoc-report.pdf"
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc
      .fontSize(18)
      .text("TrackDoc – Document Activity Report", { align: "center" })
      .moveDown();

    doc
      .fontSize(10)
      .fillColor("gray")
      .text(`Generated: ${new Date().toLocaleString()}`)
      .moveDown()
      .fillColor("black");

    activities.forEach((a) => {
      doc
        .fontSize(11)
        .text(`${a.when} — ${a.who}`)
        .fontSize(10)
        .fillColor("gray")
        .text(`  ${a.action} (revision ${a.revisionId})`)
        .fillColor("black")
        .moveDown(0.5);
    });

    doc.end();
  } catch (err) {
    console.error("[PDF] Failed:", err?.response?.data || err?.message || err);
    res.status(500).send("Failed to export PDF");
  }
});

export default router;

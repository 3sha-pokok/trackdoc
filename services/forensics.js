// services/forensics.js
import * as diff from 'diff';

export function calculateDiff(oldText, newText) {
  if (oldText === newText) return { changes: [], summary: "No changes detected." };

  const differences = diff.diffLines(oldText || "", newText || "");
  const changes = [];
  let addedCount = 0;
  let removedCount = 0;

  differences.forEach((part) => {
    if (part.added) {
      addedCount += part.value.length;
      changes.push({ type: 'added', value: part.value });
    } else if (part.removed) {
      removedCount += part.value.length;
      changes.push({ type: 'removed', value: part.value });
    }
  });

  return {
    changes,
    summary: `Added ${addedCount} characters, removed ${removedCount} characters.`,
    hasChanges: addedCount > 0 || removedCount > 0
  };
}

export function analyseBehaviourForensics(activities, opts = {}) {

  const timeZone = opts.timeZone || "Asia/Kuala_Lumpur";

  if (!Array.isArray(activities) || activities.length === 0) return null;

  const byUser = {};
  const timeline = [];

  for (const a of activities) {
    const whoRaw = (a?.who || "Unknown").trim();
    const who = whoRaw.length ? whoRaw : "Unknown";

    const ts = new Date(a?.whenISO).getTime();
    if (!Number.isFinite(ts)) continue;

    if (!byUser[who]) byUser[who] = [];
    byUser[who].push(ts);

    timeline.push({ who, time: ts });
  }

  const totalActions = timeline.length;
  if (totalActions === 0) return null;

  // Primary editor
  let primaryEditor = "Unknown";
  let maxActions = 0;
  for (const [user, times] of Object.entries(byUser)) {
    if (times.length > maxActions) {
      maxActions = times.length;
      primaryEditor = user;
    }
  }
  const primaryShare = maxActions / totalActions;

  // Unknown metrics (FIX for your UI showing 0)
  const unknownActions = (byUser["Unknown"] || []).length;
  const unknownShare = unknownActions / totalActions;

  // Collaborators (named + unknown counts)
  const collaborators = Object.keys(byUser).length;

  // Per-user breakdown (alphabetical)
  const behaviour = Object.entries(byUser)
    .map(([user, times]) => {
      const sorted = [...times].sort((a, b) => a - b);

      let avgGapMinutes = null;
      if (sorted.length > 1) {
        const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
        const avg = gaps.reduce((x, y) => x + y, 0) / gaps.length / 60000;
        avgGapMinutes = Number.isFinite(avg) ? Math.round(avg) : null;
      }

      return {
        user,
        actions: times.length,
        percentage: Math.round((times.length / totalActions) * 100),
        avgGapMinutes
      };
    })
    .sort((a, b) => a.user.localeCompare(b.user, undefined, { sensitivity: "base" }));

  // Risk scoring (focus on unknown + concentration + collaboration)
  let riskScore = 0;
  const reasons = [];

  // Unknown editor presence should increase risk strongly
  if (unknownActions > 0) {
    const add = Math.min(40, 20 + Math.round(unknownShare * 100)); // 20..40
    riskScore += add;
oreasonsPush(reasons, "Unknown editor activity detected.");
  }

  // Over-concentration: single editor dominates
  if (primaryShare >= 0.80) {
    riskScore += 25;
    reasons.push("Single editor dominates the document.");
  } else if (primaryShare >= 0.65) {
    riskScore += 15;
    reasons.push("Editor concentration is high.");
  }

  // Many collaborators can increase exposure (more accounts, more surfaces)
  if (collaborators >= 5) {
    riskScore += 20;
    reasons.push("Many collaborators increase exposure.");
  } else if (collaborators >= 3) {
    riskScore += 10;
    reasons.push("Multiple collaborators present.");
  }

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  const riskLevel =
    riskScore >= 70 ? "High" :
    riskScore >= 40 ? "Medium" :
    "Low";

  // Convenience: provide timezone for formatting in UI if needed
  return {
    primaryEditor,
    primaryShare,      // 0..1
    collaborators,
    unknownActions,
    unknownShare,      // 0..1
    riskScore,         // MATCHES your EJS
    riskLevel,
    reasons,
    behaviour,
    timeZone
  };
}

function oreasonsPush(arr, msg) {
  if (!arr.includes(msg)) arr.push(msg);
}

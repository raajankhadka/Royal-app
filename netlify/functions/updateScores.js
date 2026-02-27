// netlify/functions/updateScores.js
// Updates /scores.json in your GitHub repo by committing a new version.
// Uses env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ADMIN_SECRET

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

function b64encodeUtf8(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

function b64decodeUtf8(b64) {
  return Buffer.from(b64, "base64").toString("utf8");
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method Not Allowed" });
    }

    // Simple shared secret to prevent random people from committing to your repo
    const serverSecret = process.env.ADMIN_SECRET || "";
    const clientSecret =
      event.headers["x-admin-secret"] ||
      event.headers["X-Admin-Secret"] ||
      "";

    if (!serverSecret || clientSecret !== serverSecret) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;

    if (!token || !owner || !repo) {
      return jsonResponse(500, {
        error:
          "Missing env vars. Required: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ADMIN_SECRET",
      });
    }

    // Payload expected: { scores: { g1:{home:1,away:2}, ... } }
    const payload = JSON.parse(event.body || "{}");
    const incomingScores = payload.scores;

    if (!incomingScores || typeof incomingScores !== "object" || Array.isArray(incomingScores)) {
      return jsonResponse(400, { error: "Invalid payload. Expected { scores: {...} }" });
    }

    // GitHub Contents API path
    const path = "scores.json";
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    )}`;

    const headers = {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "netlify-function-updateScores",
    };

    // 1) Read current scores.json to get sha
    const getRes = await fetch(apiBase, { headers });
    if (!getRes.ok) {
      const t = await getRes.text();
      return jsonResponse(getRes.status, { error: "Failed to read scores.json", detail: t });
    }

    const current = await getRes.json();
    const currentContent = current.content ? b64decodeUtf8(current.content) : "{}";

    let currentJson = {};
    try { currentJson = JSON.parse(currentContent); } catch { currentJson = {}; }

    // Merge scores: keep existing unless overwritten
    const merged = {
      ...(currentJson && typeof currentJson === "object" ? currentJson : {}),
      scores: {
        ...((currentJson && currentJson.scores && typeof currentJson.scores === "object") ? currentJson.scores : {}),
        ...incomingScores
      }
    };

    const newContent = JSON.stringify(merged, null, 2);

    // 2) PUT updated file (commit)
    const putBody = {
      message: "Update scores.json (admin)",
      content: b64encodeUtf8(newContent),
      sha: current.sha,
    };

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers,
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return jsonResponse(putRes.status, { error: "Failed to update scores.json", detail: t });
    }

    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(500, { error: String(err) });
  }
};
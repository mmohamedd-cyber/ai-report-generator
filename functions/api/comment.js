export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Optional helper endpoint to discover what models YOUR key can use:
  // GET /api/models
  if (context.request.method === "GET" && url.pathname.endsWith("/api/models")) {
    return handleListModels(context);
  }

  // Your main endpoint:
  // POST /api/comment
  if (!url.pathname.endsWith("/api/comment")) {
    return new Response("Not found", { status: 404 });
  }

  if (context.request.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }

  return handleComment(context);
}

/* ---------------------------
   /api/comment (POST)
---------------------------- */
async function handleComment(context) {
  try {
    const { request, env } = context;

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ error: "Expected application/json" }, 400);
    }

    const body = await request.json();

    const studentFirstName = safeStr(body.studentFirstName || "Student");
    const strengthTopics = safeArr(body.strengthTopics);
    const developingTopics = safeArr(body.developingTopics);
    const focusTopics = safeArr(body.focusTopics);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: "Missing GEMINI_API_KEY secret" }, 500);

    // If you set GEMINI_MODEL in Cloudflare env vars, we’ll try that first.
    // Otherwise we try a safe list of common model IDs.
    const preferred = safeStr(env.GEMINI_MODEL || "");

    const modelCandidates = [
      preferred,
      // Common stable IDs (often work with API key flow)
      "gemini-1.5-flash-001",
      "gemini-1.5-pro-001",
      // Sometimes available depending on your account
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ].filter(Boolean);

    const rules = [
      "You write short school report comments for a teacher.",
      "Rules (must follow):",
      "- Do NOT include any numbers, percentages, marks, grades, or scores.",
      "- Mention the student's first name exactly once.",
      "- Use a supportive, professional tone (no emojis).",
      "- Keep it 2–4 sentences maximum.",
      "- If there are no focus topics: praise strengths and say they should continue the current effort and progress.",
      "- Otherwise: mention strengths (2–3 topics) and give clear improvement focus (2–3 topics) with brief advice."
    ].join("\n");

    const payload = {
      studentFirstName,
      strengthTopics,
      developingTopics,
      focusTopics
    };

    const prompt =
      `${rules}\n\n` +
      `Student data:\n${JSON.stringify(payload)}\n\n` +
      `Write the comment now.`;

    // Try each model until one succeeds (avoids “404 model not found” headaches)
    let lastErr = null;

    for (const model of modelCandidates) {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const resp = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      });

      const data = await safeJson(resp);

      if (resp.ok) {
        const text =
          data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("") || "";

        return json({
          comment: stripDigits(text).trim(),
          // helpful during setup; remove later if you want
          _modelUsed: model
        });
      }

      // Save error + try next model
      lastErr = { status: resp.status, data, model };
      // If it's NOT 404, it might be a real issue (permissions, key, etc.) — still try next, but keep info.
    }

    // If none worked, return the most informative error we saw
    return json(
      {
        error: "Gemini error",
        message: "All candidate models failed. Use /api/models to see available model IDs for your key.",
        lastError: lastErr
      },
      lastErr?.status || 500
    );
  } catch (err) {
    return json({ error: "Server error", detail: String(err?.message || err) }, 500);
  }
}

/* ---------------------------
   /api/models (GET)
   Lists models available to YOUR key
---------------------------- */
async function handleListModels(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: "Missing GEMINI_API_KEY secret" }, 500);

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetchWithRetry(endpoint, { method: "GET" });
    const data = await safeJson(resp);

    if (!resp.ok) {
      return json(
        {
          error: "Gemini error",
          status: resp.status,
          data
        },
        resp.status
      );
    }

    // Return just the model names for easy copy/paste
    const names = (data?.models || []).map(m => m?.name).filter(Boolean);

    return json({
      models: names,
      note: "Pick one of these names and set GEMINI_MODEL in Cloudflare env vars (Production), then redeploy."
    });
  } catch (err) {
    return json({ error: "Server error", detail: String(err?.message || err) }, 500);
  }
}

/* ---------------------------
   Helpers
---------------------------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function safeArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
}

function stripDigits(s) {
  return String(s || "").replace(/[0-9]/g, "");
}

async function safeJson(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Backoff for 429 rate limits
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, retries = 3) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;
    last = resp;
    await sleep(800 * Math.pow(2, i));
  }
  return last;
}

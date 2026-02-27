export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }
  return handlePost(context);
}

async function handlePost(context) {
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

    // If you set GEMINI_MODEL in Cloudflare, we’ll use it.
    // Otherwise default to a common one (but you should set it after /api/models works).
    const model = safeStr(env.GEMINI_MODEL) || "gemini-1.5-flash-001";

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

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!resp.ok) {
      // This will show the real reason (model not found, API not enabled, key invalid, etc.)
      return json({ error: "Gemini error", status: resp.status, data }, resp.status);
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("") || "";

    return json({ comment: stripDigits(text).trim() });

  } catch (err) {
    return json({ error: "Server error", detail: String(err?.message || err) }, 500);
  }
}

/* Helpers */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function safeStr(v) { return String(v ?? "").trim(); }
function safeArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
}
function stripDigits(s) { return String(s || "").replace(/[0-9]/g, ""); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
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

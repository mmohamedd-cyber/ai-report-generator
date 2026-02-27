export async function onRequest(context) {
  // Helpful browser message
  if (context.request.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }
  return onRequestPost(context);
}

async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return json({ error: "Expected application/json" }, 400);
    }

    const body = await request.json();

    const studentFirstName = safeStr(body.studentFirstName || "Student");
    const strengthTopics = safeArr(body.strengthTopics);
    const developingTopics = safeArr(body.developingTopics);
    const focusTopics = safeArr(body.focusTopics);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: "Missing GEMINI_API_KEY secret" }, 500);

    const model = env.GEMINI_MODEL || "gemini-1.5-flash";

    const systemRules = [
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
      `${systemRules}\n\n` +
      `Data:\n${JSON.stringify(payload)}\n\n` +
      `Write the comment now.`;

    // Gemini generateContent endpoint
    // Docs: https://ai.google.dev/api/generate-content
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Using header for the key
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg =
        data?.error?.message ||
        data?.error?.status ||
        JSON.stringify(data);
      return json({ error: "Gemini error", message: msg }, resp.status);
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("") ||
      "";

    return json({ comment: stripDigits(text).trim() });

  } catch (err) {
    return json({ error: "Server error", detail: String(err?.message || err) }, 500);
  }
}

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

// Backoff for 429 rate limits (common on free tier)
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function fetchWithRetry(url, options, retries = 4) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;
    last = resp;
    await sleep(800 * Math.pow(2, i)); // 0.8s, 1.6s, 3.2s, 6.4s...
  }
  return last;
}

// Safety net: remove digits if a model slips
function stripDigits(s) {
  return String(s || "").replace(/[0-9]/g, "");
}

export async function onRequest(context) {
  // Show helpful message in browser
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
    if (!apiKey) {
      return json({ error: "Missing GEMINI_API_KEY secret" }, 500);
    }

    // 🔥 Hardcoded safe model for free tier
    const model = "gemini-1.5-flash";

    const rules = [
      "You write short school report comments for a teacher.",
      "Rules:",
      "- Do NOT include numbers, percentages, marks, grades, or scores.",
      "- Mention the student's first name exactly once.",
      "- Use a professional supportive tone.",
      "- Keep it 2–4 sentences.",
      "- If there are no focus topics: praise strengths and encourage continued effort."
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
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return json({
        error: "Gemini error",
        status: resp.status,
        data
      }, resp.status);
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        .filter(Boolean)
        .join("") || "";

    return json({ comment: stripDigits(text).trim() });

  } catch (err) {
    return json({
      error: "Server error",
      detail: String(err?.message || err)
    }, 500);
  }
}

/* ---------- Helpers ---------- */

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;
    last = resp;
    await sleep(1000 * Math.pow(2, i));
  }
  return last;
}

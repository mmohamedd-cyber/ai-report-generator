export async function onRequest(context) {
  // Helpful for browser testing
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

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Missing OPENAI_API_KEY secret" }, 500);

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const system = [
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

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: `Generate the comment from this data:\n${JSON.stringify(payload)}` }
        ]
      })
    });

    const data = await resp.json();
    if (!resp.ok) return json({ error: "OpenAI error", detail: data }, resp.status);

    const comment = stripDigits(extractText(data)).trim();
    return json({ comment });

  } catch (err) {
    return json({ error: "Server error", detail: String(err?.message || err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function safeStr(v) { return String(v ?? "").trim(); }
function safeArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;

  const out = data?.output;
  if (Array.isArray(out)) {
    let collected = "";
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part?.text === "string") collected += part.text + "\n";
        }
      }
    }
    if (collected.trim()) return collected.trim();
  }
  return "";
}

function stripDigits(s) {
  return String(s || "").replace(/[0-9]/g, "");
}

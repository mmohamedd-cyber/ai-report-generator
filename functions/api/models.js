export async function onRequest(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json({ error: "Missing GEMINI_API_KEY secret" }, 500);
    }

    // List models available to this key
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetch(url, { method: "GET" });
    const text = await resp.text();

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      return json({ error: "Gemini error", status: resp.status, data }, resp.status);
    }

    const names = (data.models || []).map(m => m.name).filter(Boolean);

    return json({
      models: names,
      tip: "Pick one model name like models/gemini-1.5-flash-001 and set GEMINI_MODEL to the part after 'models/'."
    });

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

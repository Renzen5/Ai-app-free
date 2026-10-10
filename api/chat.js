
// Serverless proxy for JustWoker API.
// Keeps the API key on the server side (Vercel env: JUSTWOKER_API_KEY)
// and/or forwards a key provided by the client (stored locally on the device).

export default async function handler(req, res) {
  // CORS (same-origin usage, but keep it safe for local dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = req.headers['x-api-key'] || process.env.JUSTWOKER_API_KEY;
  if (!apiKey) {
    res.status(400).json({
      error: { message: 'API ключ не задан. Укажите его в настройках приложения или в переменной окружения JUSTWOKER_API_KEY.' }
    });
    return;
  }

  // Vercel parses JSON body automatically, but guard just in case.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  try {
    const upstream = await fetch('https://api.justwoker.icu/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'Ошибка обращения к JustWoker: ' + String(err) } });
  }
}

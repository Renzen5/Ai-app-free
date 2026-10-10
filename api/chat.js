// Serverless proxy for JustWoker API.
// Keeps the API key on the server side (Vercel env: JUSTWOKER_API_KEY)
// and/or forwards a key provided by the client (stored locally on the device).
// Supports streaming (Server-Sent Events) so the client can show tokens as they
// arrive and stop generation mid-stream.

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
  const wantStream = body.stream === true;

  let upstream;
  try {
    upstream = await fetch('https://api.justwoker.icu/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    res.status(502).json({ error: { message: 'Ошибка обращения к JustWoker: ' + String(err) } });
    return;
  }

  // Non-streaming request, upstream error, or no stream body → buffer and return JSON.
  if (!wantStream || !upstream.ok || !upstream.body) {
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    res.status(upstream.status).json(data);
    return;
  }

  // Stream the Server-Sent Events straight through to the client.
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = upstream.body.getReader();
  let closed = false;
  req.on('close', () => { closed = true; try { reader.cancel(); } catch (_) {} });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      res.write(Buffer.from(value));
      if (typeof res.flush === 'function') res.flush();
    }
  } catch (_) {
    // client disconnected or upstream errored mid-stream — fall through to end()
  } finally {
    res.end();
  }
}

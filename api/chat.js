const { sanitizeMessages, checkAndRecordUsage, askClaude, getDb, getIp } = require('./_chat');

const STATUS = { rate_limited: 429, busy: 503 };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_request' });

  const messages = sanitizeMessages(body.messages);
  if (!messages) return res.status(400).json({ error: 'invalid_request' });
  const lang = body.lang === 'zh' ? 'zh' : 'en';

  try {
    const db = await getDb();
    await checkAndRecordUsage(db, getIp(req));
    const reply = await askClaude(messages, lang);
    return res.status(200).json({ reply });
  } catch (e) {
    if (e && STATUS[e.code]) return res.status(STATUS[e.code]).json({ error: e.code });
    console.error('chat failed:', e && e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

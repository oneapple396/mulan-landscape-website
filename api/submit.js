const { getDb, insertSubmission } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // honeypot: real visitors never fill this hidden field
  if (body.website) return res.status(200).json({ ok: true });

  try {
    const db = await getDb();
    const id = await insertSubmission(db, body);
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    if (e && e.code === 'INVALID') return res.status(400).json({ error: e.message });
    console.error('submit failed:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

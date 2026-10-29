const { getDb } = require('./_lib');
const { buildEvent, record } = require('./_analytics');

// Receives anonymous page-view / event beacons from the website. No cookies, no raw IPs stored.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // only accept beacons sent by pages of this site
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* ignore */ }
    if (host !== req.headers.host) return res.status(204).end();
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > 4000) return res.status(413).end();
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  try {
    const ev = buildEvent(body, req);
    if (ev) await record(await getDb(), ev);
  } catch (e) {
    console.error('track failed:', e && e.message);
  }
  return res.status(204).end();
};

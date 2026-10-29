const { getDb } = require('./_lib');
const { verifyAdminRequest } = require('./_admin');
const { buildReport } = require('./_analytics');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    if (!(await verifyAdminRequest(req))) return res.status(401).json({ error: 'unauthorized' });
    const days = parseInt((req.query && req.query.range) || '30', 10);
    return res.status(200).json(await buildReport(await getDb(), days));
  } catch (e) {
    console.error('analytics failed:', e && e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

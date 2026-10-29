const { getDb, listSubmissions } = require('./_lib');
const { verifyAdminRequest } = require('./_admin');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    if (!(await verifyAdminRequest(req))) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await listSubmissions(await getDb());
    return res.status(200).json({ rows });
  } catch (e) {
    console.error('list failed:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

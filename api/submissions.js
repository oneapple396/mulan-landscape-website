const { getDb, listSubmissions, verifyAdmin } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const db = await getDb();
    const rows = await listSubmissions(db);
    return res.status(200).json({ rows });
  } catch (e) {
    console.error('list failed:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

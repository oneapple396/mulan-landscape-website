const { getDb } = require('./_lib');
const A = require('./_admin');

function getIp(req) {
  const xf = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const action = (req.query && req.query.action) || '';

  try {
    if (req.method === 'GET' && action === 'me') {
      const me = await A.verifyAdminRequest(req);
      if (!me) return res.status(401).json({ error: 'unauthorized' });
      return res.status(200).json({ ok: true, email: me.email });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (!A.originOk(req)) return res.status(403).json({ error: 'forbidden' });

    if (action === 'logout') {
      A.clearSessionCookie(req, res);
      return res.status(200).json({ ok: true });
    }

    const body = readBody(req);
    const db = await getDb();
    const col = A.adminCollection(db);

    if (action === 'login') {
      const ip = getIp(req);
      if (await A.loginLocked(db, ip)) return res.status(429).json({ error: 'too_many_attempts' });
      const doc = await col.findOne({ _id: 'admin' });
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      // always run the password hash so timing does not reveal whether the email or password was wrong
      const passwordOk = A.checkPassword(password, doc && doc.password);
      if (!doc || !doc.password || !passwordOk || email !== A.ADMIN_EMAIL) {
        await A.recordLoginFail(db, ip);
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      A.newSession(req, res, doc);
      return res.status(200).json({ ok: true, email: doc.email });
    }

    if (action === 'setup') {
      const ip = getIp(req);
      if (await A.loginLocked(db, ip)) return res.status(429).json({ error: 'too_many_attempts' });
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < A.MIN_PASSWORD || password.length > 200) return res.status(400).json({ error: 'weak_password' });
      const doc = await col.findOne({ _id: 'admin', setup_hash: A.sha256hex(token), setup_expires: { $gt: new Date() } });
      if (!token || !doc) {
        await A.recordLoginFail(db, ip);
        return res.status(400).json({ error: 'invalid_token' });
      }
      const sv = (doc.session_version || 1) + 1;
      await col.updateOne(
        { _id: 'admin' },
        { $set: { password: A.hashPassword(password), session_version: sv, updated_at: new Date() }, $unset: { setup_hash: '', setup_expires: '' } }
      );
      A.newSession(req, res, { email: doc.email, session_version: sv });
      return res.status(200).json({ ok: true, email: doc.email });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    console.error('admin failed:', e && e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

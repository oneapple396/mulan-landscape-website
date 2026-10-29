const crypto = require('crypto');
const { getDb, collection } = require('./_lib');

const ADMIN_EMAIL = 'oneapple396@gmail.com';
const COOKIE_NAME = 'mulan_admin';
const SESSION_TTL_SEC = 7 * 24 * 3600;
const MIN_PASSWORD = 10;

const LOGIN_FAILS_PER_IP = 5; // per 15 minutes
const LOGIN_FAILS_GLOBAL = 30; // per hour

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('ADMIN_SESSION_SECRET is missing or too short');
  return s;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest();
}

function signToken(payload) {
  const data = b64u(JSON.stringify(payload));
  return data + '.' + b64u(hmac(data));
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const data = token.slice(0, i);
  let sig;
  try { sig = Buffer.from(token.slice(i + 1), 'base64url'); } catch (e) { return null; }
  const expected = hmac(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  return payload;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function checkPassword(password, rec) {
  const salt = rec && rec.salt ? Buffer.from(rec.salt, 'base64') : Buffer.alloc(16);
  const expected = rec && rec.hash ? Buffer.from(rec.hash, 'base64') : Buffer.alloc(64);
  const actual = crypto.scryptSync(String(password), salt, 64);
  return !!(rec && rec.hash) && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function adminCollection(db) {
  return collection(db, 'admin_auth');
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isLocal(req) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test((req.headers && req.headers.host) || '');
}

function setSessionCookie(req, res, token) {
  const parts = [COOKIE_NAME + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + SESSION_TTL_SEC];
  if (!isLocal(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [COOKIE_NAME + '=', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (!isLocal(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function newSession(req, res, adminDoc) {
  const now = Math.floor(Date.now() / 1000);
  setSessionCookie(req, res, signToken({ e: adminDoc.email, sv: adminDoc.session_version || 1, iat: now, exp: now + SESSION_TTL_SEC }));
}

// Returns { email } when the request carries a valid admin session cookie, otherwise null.
async function verifyAdminRequest(req) {
  let payload;
  try { payload = verifyToken(parseCookies(req)[COOKIE_NAME]); } catch (e) { return null; }
  if (!payload) return null;
  const db = await getDb();
  const doc = await adminCollection(db).findOne({ _id: 'admin' });
  if (!doc || !doc.password || doc.email !== payload.e || (doc.session_version || 1) !== payload.sv) return null;
  return { email: doc.email };
}

// Blocks cross-site form/fetch abuse: when a browser sends an Origin it must be this site.
function originOk(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function ipHash(ip) {
  return crypto.createHash('sha256').update('admin-login|' + (ip || 'unknown')).digest('hex').slice(0, 32);
}

async function ensureLoginIndexes(db) {
  if (!global.__adminLoginIdx) {
    global.__adminLoginIdx = collection(db, 'admin_login_fails')
      .createIndexes([{ key: { ts: 1 }, expireAfterSeconds: 24 * 3600 }, { key: { ip: 1, ts: -1 } }])
      .catch(() => { global.__adminLoginIdx = null; });
  }
  return global.__adminLoginIdx;
}

async function loginLocked(db, ip) {
  await ensureLoginIndexes(db);
  const col = collection(db, 'admin_login_fails');
  const now = Date.now();
  const [mine, all] = await Promise.all([
    col.countDocuments({ ip: ipHash(ip), ts: { $gte: new Date(now - 15 * 60 * 1000) } }),
    col.countDocuments({ ts: { $gte: new Date(now - 3600 * 1000) } }),
  ]);
  return mine >= LOGIN_FAILS_PER_IP || all >= LOGIN_FAILS_GLOBAL;
}

async function recordLoginFail(db, ip) {
  await collection(db, 'admin_login_fails').insertOne({ ip: ipHash(ip), ts: new Date() });
}

module.exports = {
  ADMIN_EMAIL, COOKIE_NAME, SESSION_TTL_SEC, MIN_PASSWORD,
  signToken, verifyToken, hashPassword, checkPassword, sha256hex,
  adminCollection, parseCookies, setSessionCookie, clearSessionCookie, newSession,
  verifyAdminRequest, originOk, loginLocked, recordLoginFail,
};

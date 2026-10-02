const { MongoClient } = require('mongodb');

const SUPABASE_URL = 'https://vsgggqheczvweaouoezz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZ2dncWhlY3p2d2Vhb3VvZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NjAyMzgsImV4cCI6MjEwNjAzNjIzOH0.Z8d4cbx5h5vdy6yJWd8agaSw6SisuHVrQ6XAq8AC4mk';
const ADMIN_EMAIL = 'oneapple396@gmail.com';
const FILE_URL_PREFIX = SUPABASE_URL + '/storage/v1/object/public/';
const COLLECTION = 'survey_submissions';

const cache = global.__mongoCache || (global.__mongoCache = { promise: null });

function getDb() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!cache.promise) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    cache.promise = client.connect().then((c) => c.db()).catch((e) => { cache.promise = null; throw e; });
  }
  return cache.promise;
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null; };
const strList = (v, maxItems, maxLen) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.trim().slice(0, maxLen)).filter(Boolean) : [];
const fileUrl = (v) => (typeof v === 'string' && v.startsWith(FILE_URL_PREFIX) && v.length < 500 ? v : null);
const dateStr = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function cleanSubmission(b) {
  b = b && typeof b === 'object' ? b : {};
  return {
    name: str(b.name, 200),
    phone: str(b.phone, 50),
    email: str(b.email, 200),
    project_start_date: dateStr(b.project_start_date),
    address: str(b.address, 300),
    household_size: int(b.household_size),
    num_children: int(b.num_children),
    children_ages: str(b.children_ages, 200),
    pets: str(b.pets, 200),
    budget: str(b.budget, 100),
    spaces: strList(b.spaces, 20, 200),
    spaces_other: str(b.spaces_other, 300),
    material: str(b.material, 200),
    plants: strList(b.plants, 20, 200),
    hoa: str(b.hoa, 200),
    utilities: strList(b.utilities, 20, 200),
    notes: str(b.notes, 5000),
    inspiration_image_urls: strList(b.inspiration_image_urls, 30, 500).map(fileUrl).filter(Boolean),
    plot_map_url: fileUrl(b.plot_map_url),
  };
}

async function insertSubmission(db, body) {
  const doc = cleanSubmission(body);
  if (!doc.name && !doc.phone && !doc.email) {
    const err = new Error('Please provide at least a name, phone or email.');
    err.code = 'INVALID';
    throw err;
  }
  doc.created_at = new Date();
  const res = await db.collection(COLLECTION).insertOne(doc);
  return String(res.insertedId);
}

async function listSubmissions(db) {
  const rows = await db.collection(COLLECTION).find({}).sort({ created_at: -1 }).limit(500).toArray();
  return rows.map((r) => ({ ...r, id: String(r._id), _id: undefined }));
}

async function verifyAdmin(req, fetchFn) {
  const f = fetchFn || fetch;
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  try {
    const r = await f(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + m[1] },
    });
    if (!r.ok) return false;
    const u = await r.json();
    return !!u && typeof u.email === 'string' && u.email.toLowerCase() === ADMIN_EMAIL;
  } catch (e) {
    return false;
  }
}

module.exports = { getDb, cleanSubmission, insertSubmission, listSubmissions, verifyAdmin, COLLECTION };

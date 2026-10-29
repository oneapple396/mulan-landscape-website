const crypto = require('crypto');
const { collection } = require('./_lib');

const TZ = 'America/Los_Angeles';
const SITE_HOSTS = ['mulanlandscapeinc.com'];
const EVENT_NAMES = ['click_phone', 'click_email', 'survey_start', 'survey_submit', 'chat_open', 'chat_message', 'section', 'lang_en', 'lang_zh'];
const SECTION_IDS = ['portfolio-gallery', 'small-medium-yard', 'about', 'survey', 'reviews'];
const RETENTION_SEC = 400 * 24 * 3600;
const MAX_EVENTS_PER_VISITOR_HOUR = 300;

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|headless|lighthouse|pagespeed|gtmetrix|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|monitor|uptime|vercel|preview|screenshot|phantom|selenium|puppeteer|playwright/i;

function isBot(ua) {
  return !ua || ua.length < 10 || BOT_RE.test(ua);
}

function parseUA(ua) {
  ua = ua || '';
  const device = /ipad|tablet|(android(?!.*mobile))/i.test(ua) ? 'Tablet' : /mobi|iphone|ipod|android/i.test(ua) ? 'Mobile' : 'Desktop';
  let browser = 'Other';
  if (/MicroMessenger/i.test(ua)) browser = 'WeChat';
  else if (/FBAN|FBAV/i.test(ua)) browser = 'Facebook app';
  else if (/Instagram/i.test(ua)) browser = 'Instagram app';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  let os = 'Other';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return { device, browser, os };
}

const SEARCH = /(^|\.)(google|bing|baidu|duckduckgo|yahoo|ecosia|yandex|sogou|so|naver|brave|qwant|startpage)\./i;
const SOCIAL = /(facebook|fb\.com|instagram|twitter|t\.co|^x\.com|linkedin|pinterest|youtube|youtu\.be|tiktok|reddit|nextdoor|wechat|weixin|weibo|xiaohongshu|xhslink|douyin|whatsapp|line\.me|telegram|yelp|houzz)/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}

// Returns { channel, source } for a visit's attribution data.
function classify(attr) {
  attr = attr || {};
  const src = String(attr.utm_source || '').toLowerCase();
  const med = String(attr.utm_medium || '').toLowerCase();
  const refHost = hostOf(attr.ref || '');
  const internal = SITE_HOSTS.some((h) => refHost === h || refHost.endsWith('.' + h)) || /\.vercel\.app$/.test(refHost);
  const source = src || (!internal && refHost) || '(direct)';

  if (attr.gclid || /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|display|ads|paidsocial|paid_social)$/.test(med)) return { channel: 'Paid ads', source };
  if (/^(gbp|gmb|google_business|googlebusiness|googlemaps|maps)$/.test(src)) return { channel: 'Google Business Profile', source };
  if (med === 'email' || src === 'email' || /newsletter/.test(src)) return { channel: 'Email', source };
  if (internal || (!refHost && !src)) return { channel: 'Direct', source: '(direct)' };
  const host = refHost || src;
  if (SEARCH.test(host + '.') || SEARCH.test(src + '.')) return { channel: 'Organic search', source };
  if (SOCIAL.test(host) || SOCIAL.test(src)) return { channel: 'Social', source };
  return { channel: 'Referral', source };
}

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, n) : '');

function laDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date || new Date());
}

function visitorId(ip, ua, day) {
  const salt = process.env.ADMIN_SESSION_SECRET || 'mulan-analytics';
  return crypto.createHash('sha256').update(salt + '|' + day + '|' + (ip || '') + '|' + (ua || '')).digest('hex').slice(0, 20);
}

function decodeHeader(v) {
  if (!v) return '';
  try { return decodeURIComponent(String(v)); } catch (e) { return String(v); }
}

// Validates and normalises a tracking beacon. Returns null when it should be ignored.
function buildEvent(body, req) {
  if (!body || typeof body !== 'object') return null;
  const ua = (req.headers && req.headers['user-agent']) || '';
  if (isBot(ua)) return null;
  const type = body.type === 'ev' ? 'ev' : body.type === 'pv' ? 'pv' : null;
  if (!type) return null;
  let name = '';
  let label = '';
  if (type === 'ev') {
    name = clip(body.name, 30);
    if (EVENT_NAMES.indexOf(name) === -1) return null;
    if (name === 'section') {
      label = clip(body.label, 40);
      if (SECTION_IDS.indexOf(label) === -1) return null;
    }
  }
  const a = body.attr && typeof body.attr === 'object' ? body.attr : {};
  const attr = {
    ref: clip(a.ref, 300),
    utm_source: clip(a.utm_source, 80),
    utm_medium: clip(a.utm_medium, 80),
    utm_campaign: clip(a.utm_campaign, 120),
    utm_term: clip(a.utm_term, 120),
    gclid: !!a.gclid,
  };
  const { channel, source } = classify(attr);
  const ip = (req.headers && ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'])) || '';
  const now = new Date();
  const day = laDay(now);
  const h = req.headers || {};
  const ev = {
    ts: now,
    day,
    type,
    visitor: visitorId(ip, ua, day),
    path: clip(body.path, 200) || '/',
    lang: body.lang === 'zh-CN' || body.lang === 'zh' ? 'zh' : 'en',
    channel,
    source: clip(source, 80),
    utm_campaign: attr.utm_campaign || null,
    utm_medium: attr.utm_medium || null,
    paid_click: attr.gclid,
    country: clip(decodeHeader(h['x-vercel-ip-country']), 4) || null,
    region: clip(decodeHeader(h['x-vercel-ip-country-region']), 40) || null,
    city: clip(decodeHeader(h['x-vercel-ip-city']), 60) || null,
    ...parseUA(ua),
  };
  if (type === 'ev') { ev.name = name; if (label) ev.label = label; }
  return ev;
}

async function ensureIndexes(db) {
  if (!global.__analyticsIdx) {
    global.__analyticsIdx = collection(db, 'analytics_events')
      .createIndexes([
        { key: { ts: 1 }, expireAfterSeconds: RETENTION_SEC },
        { key: { type: 1, ts: -1 } },
        { key: { visitor: 1, ts: -1 } },
      ])
      .catch(() => { global.__analyticsIdx = null; });
  }
  return global.__analyticsIdx;
}

async function record(db, ev) {
  await ensureIndexes(db);
  const col = collection(db, 'analytics_events');
  const recent = await col.countDocuments({ visitor: ev.visitor, ts: { $gte: new Date(Date.now() - 3600 * 1000) } });
  if (recent >= MAX_EVENTS_PER_VISITOR_HOUR) return false;
  await col.insertOne(ev);
  return true;
}

/* ---------------- reporting ---------------- */

function dayKeys(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(laDay(new Date(Date.now() - i * 86400000)));
  return out;
}

async function groupViews(col, match, keyExpr, limit) {
  const rows = await col.aggregate([
    { $match: match },
    { $group: { _id: keyExpr, views: { $sum: 1 }, visitors: { $addToSet: '$visitor' } } },
    { $project: { views: 1, visitors: { $size: '$visitors' } } },
    { $sort: { views: -1 } },
    { $limit: limit },
  ]).toArray();
  return rows;
}

async function buildReport(db, days) {
  days = [7, 30, 90].indexOf(days) === -1 ? 30 : days;
  const col = collection(db, 'analytics_events');
  const since = new Date(Date.now() - days * 86400000);
  const pv = { type: 'pv', ts: { $gte: since } };
  const ev = { type: 'ev', ts: { $gte: since } };
  const half = new Date(Date.now() - 30 * 60 * 1000);

  const [byDay, dayVisitors, channels, sources, campaigns, pages, countries, cities, devices, browsers, languages, events, sections, convByChannel, recent, live, inquiries] = await Promise.all([
    col.aggregate([{ $match: pv }, { $group: { _id: '$day', views: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $match: pv }, { $group: { _id: { d: '$day', v: '$visitor' } } }, { $group: { _id: '$_id.d', visitors: { $sum: 1 } } }]).toArray(),
    groupViews(col, pv, '$channel', 10),
    groupViews(col, pv, { source: '$source', channel: '$channel' }, 12),
    groupViews(col, { ...pv, $or: [{ paid_click: true }, { utm_campaign: { $ne: null } }, { utm_medium: { $ne: null } }] },
      { campaign: '$utm_campaign', medium: '$utm_medium', source: '$source', ads: '$paid_click' }, 15),
    groupViews(col, pv, '$path', 8),
    groupViews(col, pv, '$country', 10),
    groupViews(col, pv, { city: '$city', region: '$region', country: '$country' }, 12),
    groupViews(col, pv, '$device', 5),
    groupViews(col, pv, '$browser', 8),
    groupViews(col, pv, '$lang', 3),
    col.aggregate([{ $match: { ...ev, name: { $ne: 'section' } } }, { $group: { _id: '$name', count: { $sum: 1 }, visitors: { $addToSet: '$visitor' } } },
      { $project: { count: 1, visitors: { $size: '$visitors' } } }]).toArray(),
    col.aggregate([{ $match: { ...ev, name: 'section' } }, { $group: { _id: '$label', visitors: { $addToSet: '$visitor' } } },
      { $project: { visitors: { $size: '$visitors' } } }]).toArray(),
    col.aggregate([{ $match: { ...ev, name: { $in: ['survey_submit', 'click_phone', 'click_email', 'chat_message'] } } },
      { $group: { _id: { channel: '$channel', name: '$name' }, visitors: { $addToSet: '$visitor' } } },
      { $project: { visitors: { $size: '$visitors' } } }]).toArray(),
    col.find({ ts: { $gte: new Date(Date.now() - 3 * 86400000) }, name: { $ne: 'section' } }).sort({ ts: -1 }).limit(25)
      .project({ _id: 0, ts: 1, type: 1, name: 1, label: 1, path: 1, channel: 1, source: 1, city: 1, region: 1, country: 1, device: 1, browser: 1, lang: 1 }).toArray(),
    col.distinct('visitor', { ts: { $gte: half } }),
    collection(db, 'survey_submissions').countDocuments({ created_at: { $gte: since } }),
  ]);

  const viewsMap = Object.fromEntries(byDay.map((r) => [r._id, r.views]));
  const visMap = Object.fromEntries(dayVisitors.map((r) => [r._id, r.visitors]));
  const series = dayKeys(days).map((d) => ({ day: d, views: viewsMap[d] || 0, visitors: visMap[d] || 0 }));
  const totalViews = series.reduce((s, r) => s + r.views, 0);
  const totalVisitors = series.reduce((s, r) => s + r.visitors, 0);

  const evMap = Object.fromEntries(events.map((r) => [r._id, { count: r.count, visitors: r.visitors }]));
  const e = (n) => evMap[n] || { count: 0, visitors: 0 };

  const conv = {};
  convByChannel.forEach((r) => {
    const ch = r._id.channel || 'Direct';
    conv[ch] = conv[ch] || {};
    conv[ch][r._id.name] = r.visitors;
  });

  return {
    range: days,
    generated_at: new Date().toISOString(),
    totals: { views: totalViews, visitors: totalVisitors, live_visitors: live.length, inquiries_in_range: inquiries },
    events: {
      click_phone: e('click_phone'), click_email: e('click_email'), survey_start: e('survey_start'), survey_submit: e('survey_submit'),
      chat_open: e('chat_open'), chat_message: e('chat_message'), lang_zh: e('lang_zh'), lang_en: e('lang_en'),
    },
    series,
    channels: channels.map((r) => ({ name: r._id || 'Direct', views: r.views, visitors: r.visitors })),
    sources: sources.map((r) => ({ name: r._id.source || '(direct)', channel: r._id.channel, views: r.views, visitors: r.visitors })),
    campaigns: campaigns.map((r) => ({ campaign: r._id.campaign || '(not set)', medium: r._id.medium || '', source: r._id.source || '', google_ads: !!r._id.ads, views: r.views, visitors: r.visitors })),
    pages: pages.map((r) => ({ name: r._id, views: r.views, visitors: r.visitors })),
    countries: countries.map((r) => ({ name: r._id || 'Unknown', views: r.views, visitors: r.visitors })),
    cities: cities.map((r) => ({ name: [r._id.city, /^\d+$/.test(r._id.region || '') ? '' : r._id.region].filter(Boolean).join(', ') || 'Unknown', country: r._id.country || '', views: r.views, visitors: r.visitors })),
    devices: devices.map((r) => ({ name: r._id, views: r.views, visitors: r.visitors })),
    browsers: browsers.map((r) => ({ name: r._id, views: r.views, visitors: r.visitors })),
    languages: languages.map((r) => ({ name: r._id === 'zh' ? '中文' : 'English', views: r.views, visitors: r.visitors })),
    sections: SECTION_IDS.map((id) => ({ id, visitors: (sections.find((s) => s._id === id) || {}).visitors || 0 })),
    conversions_by_channel: conv,
    recent: recent.map((r) => ({ ...r, ts: r.ts.toISOString() })),
  };
}

module.exports = { isBot, parseUA, classify, buildEvent, record, buildReport, laDay, visitorId, EVENT_NAMES, SECTION_IDS };

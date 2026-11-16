// Renders heypullup.com/join/<token> (vercel.json rewrites it here).
//
// The page itself is join.html; this fills in the plan's title, host and place
// so link previews in iMessage/WhatsApp show the actual plan, and hands the
// preview to the page so it doesn't have to fetch it again. With the app
// installed, iOS opens the link in the app and never loads this.

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

const template = fs.readFileSync(path.join(process.cwd(), 'join.html'), 'utf8');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// JSON inside <script>: escape "<" so a plan title can't close the tag.
function scriptJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

async function fetchPreview(token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_preview`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) throw new Error(`invite_preview ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

module.exports = async (req, res) => {
  const token = String(req.query.token ?? '');
  let preview = null;
  let failed = false;
  if (TOKEN_RE.test(token)) {
    try {
      preview = await fetchPreview(token);
    } catch (e) {
      // Still serve the page; it shows Open in Pull Up and retries in the browser.
      failed = true;
      console.error(e);
    }
  }

  let title = "You're invited to a plan on Pull Up";
  let description = 'Tap to join, vote on the spot and see who\'s on the way.';
  if (preview) {
    title = preview.host_name
      ? `${preview.host_name} invited you to ${preview.plan_title}`
      : `You're invited to ${preview.plan_title}`;
    const bits = [];
    if (preview.place_name) bits.push(preview.place_name);
    if (preview.going_count > 0) bits.push(`${preview.going_count} going`);
    bits.push('Tap to join on Pull Up');
    description = bits.join(' · ');
  }

  const boot = {
    token,
    preview,
    failed,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  };

  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(preview ? preview.plan_title : "You're invited")} · Pull Up</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(description)}`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(description)}`)
    .replace('<script id="boot"></script>', `<script id="boot">window.__JOIN__ = ${scriptJson(boot)};</script>`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Plans change (votes, venue locks), so previews are cached only briefly.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(preview || failed ? 200 : 404).send(html);
};

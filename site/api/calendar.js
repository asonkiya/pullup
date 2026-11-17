// Serves heypullup.com/join/<token>/calendar.ics (vercel.json rewrites it here):
// the plan as a calendar event with a reminder an hour before, so a guest
// without the app still gets nudged on the day. A real URL rather than a file
// built in the page, because in-app browsers (WhatsApp, Instagram) don't
// reliably open generated downloads.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EVENT_HOURS = 2;

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

// 20261120T193000Z
function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function text(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

// Lines are capped at 75 bytes; longer ones continue on a line starting with a space.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 74) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

module.exports = async (req, res) => {
  const token = String(req.query.token ?? '');
  let preview = null;
  if (TOKEN_RE.test(token)) {
    try {
      preview = await fetchPreview(token);
    } catch (e) {
      console.error(e);
      return res.status(502).send('Could not load the plan. Try again.');
    }
  }
  const at = preview && (preview.arrival_time || preview.scheduled_for);
  if (!at || preview.state === 'cancelled') return res.status(404).send('Not found');

  const start = new Date(at);
  const end = new Date(start.getTime() + EVENT_HOURS * 3600 * 1000);
  const link = `https://heypullup.com/join/${token}`;
  const place = preview.place_name || preview.pick_name;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pull Up//heypullup.com//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${token}@heypullup.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(preview.plan_title)}`,
    place ? `LOCATION:${text(place)}` : null,
    `DESCRIPTION:${text((preview.host_name ? `With ${preview.host_name} and the crew. ` : '') + `Who's coming and where: ${link}`)}`,
    `URL:${link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(preview.plan_title)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).map(fold);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="pullup.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(lines.join('\r\n') + '\r\n');
};

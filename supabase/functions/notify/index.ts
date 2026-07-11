import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type NotifyEvent =
  | 'member_joined'
  | 'venue_suggested'
  | 'venue_locked'
  | 'voting_reopened'
  | 'plan_activated'
  | 'plan_ended'
  | 'plan_cancelled'
  | 'leaving'
  | 'arrived'
  | 'chat_message'
  | 'crew_reinvite'
  | 'crew_invited'
  | 'venue_tie';

interface NotifyPayload {
  event: NotifyEvent;
  plan_id: string;
  actor_user_id: string;
  // When set, send to exactly these users instead of the plan's members
  // (used to invite people who aren't in the plan yet).
  recipient_user_ids?: string[];
  extra: {
    actor_name: string;
    plan_title: string;
    place_name?: string;
    message_body?: string;
    // crew_reinvite: recipients are the OLD plan's members; tapping routes
    // to /join/{join_token} for the new plan instead of the plan screen.
    join_token?: string;
  };
}

function buildMessage(payload: NotifyPayload): { title: string; body: string } {
  const { event, extra } = payload;
  const { actor_name, plan_title, place_name, message_body } = extra;

  switch (event) {
    case 'member_joined':
      return { title: plan_title, body: `${actor_name} joined` };
    case 'venue_suggested':
      return { title: plan_title, body: `${actor_name} suggested ${place_name ?? 'a spot'}` };
    case 'venue_locked':
      return { title: plan_title, body: `Venue set: ${place_name ?? 'unknown'}` };
    case 'voting_reopened':
      return { title: plan_title, body: `${actor_name} re-opened voting — pick again` };
    case 'plan_activated':
      return { title: plan_title, body: `${plan_title} is happening now!` };
    case 'plan_ended':
      return { title: plan_title, body: `${plan_title} has ended` };
    case 'plan_cancelled':
      return { title: plan_title, body: `${plan_title} was cancelled` };
    case 'leaving':
      return { title: plan_title, body: `${actor_name} is on the way!` };
    case 'arrived':
      return { title: plan_title, body: `${actor_name} arrived!` };
    case 'chat_message':
      return { title: plan_title, body: `${actor_name}: ${(message_body ?? '').slice(0, 100)}` };
    case 'crew_reinvite':
      return { title: plan_title, body: `${actor_name} is planning another one — tap to join` };
    case 'crew_invited':
      return { title: plan_title, body: `${actor_name} invited you — tap to join` };
    case 'venue_tie':
      return { title: plan_title, body: `It's a tie! Two spots are equally loved — you pick the winner` };
    default:
      return { title: plan_title, body: 'New activity' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  // Authenticate caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  let payload: NotifyPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { event, plan_id, actor_user_id } = payload;
  if (!event || !plan_id || !actor_user_id) {
    return new Response('Missing required fields', { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let recipients: Array<{ user_id: string; role: string; users: { push_token: string | null } | null }>;

  if (payload.recipient_user_ids?.length) {
    // Explicit recipients (people not yet in the plan)
    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select('id, push_token')
      .in('id', payload.recipient_user_ids);
    if (usersError || !users) {
      return new Response(JSON.stringify({ sent: 0, error: 'Failed to fetch recipients' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    recipients = users
      .filter((u) => u.id !== actor_user_id && u.push_token)
      .map((u) => ({ user_id: u.id, role: 'member', users: { push_token: u.push_token } }));
  } else {
    // Fetch plan members with their push tokens
    const { data: members, error: membersError } = await adminClient
      .from('plan_members')
      .select('user_id, role, users(push_token)')
      .eq('plan_id', plan_id);

    if (membersError || !members) {
      return new Response(JSON.stringify({ sent: 0, error: 'Failed to fetch members' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    recipients = (members as unknown as typeof recipients).filter(
      (m) => m.user_id !== actor_user_id && m.users?.push_token
    );

    // Host-only events
    if (event === 'member_joined' || event === 'venue_tie') {
      recipients = recipients.filter((m) => m.role === 'host');
    }
  }

  if (recipients.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { title, body } = buildMessage(payload);

  // Build Expo push messages
  const messages = recipients.map((m) => {
    const userRecord = (m as Record<string, unknown>).users as { push_token: string | null };
    return {
      to: userRecord.push_token!,
      title,
      body,
      sound: 'default' as const,
      data: payload.extra?.join_token
        ? { plan_id, join_token: payload.extra.join_token }
        : { plan_id },
    };
  });

  // Send via Expo Push API (batch)
  let tickets: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }> = [];
  try {
    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!pushRes.ok) {
      const errText = await pushRes.text();
      console.error('Expo Push API HTTP error:', pushRes.status, errText);
    } else {
      const json = await pushRes.json();
      tickets = json.data ?? [];
    }
  } catch (err) {
    console.error('Failed to call Expo Push API:', err);
  }

  // Clear push tokens for devices that are no longer registered
  const staleTokens: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
      staleTokens.push(messages[i].to);
    }
  });
  if (staleTokens.length > 0) {
    console.warn(`Clearing ${staleTokens.length} stale push token(s)`);
    await adminClient.from('users').update({ push_token: null }).in('push_token', staleTokens);
  }

  const okCount = tickets.filter((t) => t.status === 'ok').length;
  console.log(`notify event=${event} sent=${messages.length} ok=${okCount} errors=${messages.length - okCount}`);

  return new Response(JSON.stringify({ sent: messages.length, ok: okCount, errors: messages.length - okCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

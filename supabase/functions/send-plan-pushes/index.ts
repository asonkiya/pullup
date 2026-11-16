import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Delivers the reminder pushes that run_plan_automation() queued in
// plan_pushes (see migration 20261117000000_plans_run_themselves.sql).
//
// pg_cron calls this every 5 minutes when the queue isn't empty. It takes no
// input and needs no caller identity (deploy with --no-verify-jwt): all it can
// do is send pushes the database already decided to send, and claim_plan_pushes
// hands each one out exactly once.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

// Expo accepts up to 100 messages per request.
const EXPO_BATCH = 100;

type ClaimedPush = {
  id: number;
  plan_id: string;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  push_token: string;
};

type Ticket = { status: string; details?: { error?: string } };

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await admin.rpc('claim_plan_pushes');
  if (error) {
    console.error('claim_plan_pushes failed:', error);
    return Response.json({ error: 'claim failed' }, { status: 500 });
  }
  const pushes = (data ?? []) as ClaimedPush[];
  if (pushes.length === 0) return Response.json({ sent: 0 });

  let ok = 0;
  const staleTokens: string[] = [];

  for (let i = 0; i < pushes.length; i += EXPO_BATCH) {
    const batch = pushes.slice(i, i + EXPO_BATCH);
    const messages = batch.map((p) => ({
      to: p.push_token,
      title: p.title,
      body: p.body,
      sound: 'default' as const,
      // The app routes a tap to data.route, falling back to the plan screen.
      data: { plan_id: p.plan_id, event: p.kind, ...(p.route ? { route: p.route } : {}) },
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        console.error('Expo Push API HTTP error:', res.status, await res.text());
        continue;
      }
      const tickets: Ticket[] = (await res.json()).data ?? [];
      tickets.forEach((t, j) => {
        if (t.status === 'ok') ok++;
        else if (t.details?.error === 'DeviceNotRegistered') staleTokens.push(messages[j].to);
      });
    } catch (err) {
      console.error('Failed to call Expo Push API:', err);
    }
  }

  // Clear push tokens for devices that are no longer registered.
  if (staleTokens.length > 0) {
    console.warn(`Clearing ${staleTokens.length} stale push token(s)`);
    await admin.from('users').update({ push_token: null }).in('push_token', staleTokens);
  }

  const kinds = pushes.reduce<Record<string, number>>((acc, p) => {
    acc[p.kind] = (acc[p.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`send-plan-pushes claimed=${pushes.length} ok=${ok} kinds=${JSON.stringify(kinds)}`);

  return Response.json({ sent: pushes.length, ok });
});

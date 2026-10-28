import { supabase } from './supabase';

/**
 * Funnel + monetization event names. Keep this list tight and meaningful — these
 * are what we'll use to validate retention and negotiate affiliate deals.
 *
 * The plan→arrival funnel:
 *   plan_created → plan_joined → venue_locked → eta_share_started
 *   → departure_leaving → departure_arrived
 *
 * Monetization:
 *   affiliate_click — a high-intent click on a "Get a ride" CTA
 *   navigate_click — turn-by-turn handoff to Google Maps
 */
export type AnalyticsEvent =
  | 'plan_created'
  | 'plan_joined'
  | 'venue_suggested'
  | 'venue_locked'
  | 'eta_share_started'
  | 'departure_leaving'
  | 'departure_arrived'
  | 'affiliate_click'
  | 'navigate_click';

type LogOptions = {
  planId?: string | null;
  properties?: Record<string, unknown>;
};

/**
 * Fire-and-forget analytics. Never throws, never blocks the UI, and is a no-op
 * when there's no authenticated user (RLS requires user_id = auth.uid()).
 */
export async function logEvent(event: AnalyticsEvent, opts: LogOptions = {}): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    await supabase.from('analytics_events').insert({
      user_id: userId,
      plan_id: opts.planId ?? null,
      event_name: event,
      properties_json: (opts.properties ?? null) as never,
    });
  } catch {
    // Analytics must never break the app.
  }
}

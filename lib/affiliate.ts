/**
 * Affiliate / high-intent commerce links surfaced at the locked + LIVE moments.
 *
 * The deep links here work today without any partnership — they just open the
 * partner app/site pre-filled with the venue. Affiliate ATTRIBUTION (earning a
 * cut) is layered in by setting the codes in AFFILIATE below once the programs
 * are approved (Uber affiliate, OpenTable via Impact/CJ, etc.). Until then these
 * are pure user-value-add CTAs and we still track click intent via analytics.
 */
export const AFFILIATE = {
  // Uber affiliate client_id (Uber Affiliate Program). Empty = plain deep link.
  uberClientId: '',
};

export type Venue = {
  name: string;
  lat: number;
  lng: number;
};

/** Uber universal link with the venue as the dropoff. */
export function rideUrl(venue: Venue): string {
  const params = new URLSearchParams({
    action: 'setPickup',
    pickup: 'my_location',
    'dropoff[latitude]': String(venue.lat),
    'dropoff[longitude]': String(venue.lng),
    'dropoff[nickname]': venue.name,
  });
  if (AFFILIATE.uberClientId) params.set('client_id', AFFILIATE.uberClientId);
  return `https://m.uber.com/ul/?${params.toString()}`;
}

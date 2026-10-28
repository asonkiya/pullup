import * as SecureStore from 'expo-secure-store';

/**
 * A place the user was headed before auth got in the way: an invite link or a
 * notification tapped while signed out. The root layout replays it once a
 * session exists, so signup lands you in the plan instead of an empty home.
 */
const KEY = 'pending_route';
// Written by builds before pending_route existed.
const LEGACY_JOIN_KEY = 'pending_join_token';

export async function setPendingRoute(route: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, route);
  } catch {}
}

export async function hasPendingRoute(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(KEY)) || !!(await SecureStore.getItemAsync(LEGACY_JOIN_KEY));
  } catch {
    return false;
  }
}

/** Returns the pending route (if any) and clears it. */
export async function consumePendingRoute(): Promise<string | null> {
  try {
    const route = await SecureStore.getItemAsync(KEY);
    const legacyToken = await SecureStore.getItemAsync(LEGACY_JOIN_KEY);
    await SecureStore.deleteItemAsync(KEY);
    await SecureStore.deleteItemAsync(LEGACY_JOIN_KEY);
    return route ?? (legacyToken ? `/join/${legacyToken}` : null);
  } catch {
    return null;
  }
}

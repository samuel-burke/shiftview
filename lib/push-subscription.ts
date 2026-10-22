import type { SupabaseClient } from "@supabase/supabase-js";

async function getPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  // ready never settles when there is no active worker; logout must work then too.
  const registration = await navigator.serviceWorker.getRegistration();
  return await registration?.pushManager?.getSubscription() ?? null;
}

export async function revokePushSubscription() {
  const subscription = await getPushSubscription();
  if (!subscription) return;

  // Remove this account's association while its authentication is still present.
  // Even if the server is unavailable, browser revocation prevents delivery;
  // notify.ts removes the stale row when the push service reports it gone.
  try {
    const response = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok) console.warn("[push] Could not remove server subscription");
  } catch {
    console.warn("[push] Could not remove server subscription");
  }

  // Always revoke locally too: legacy endpoints may be associated with more
  // than one account. A rejection must prevent logout. false means the
  // subscription was already deactivated (Push API specification).
  await subscription.unsubscribe();
}

// A subscription left by an earlier session must never be reused by a new
// account. RLS lets us check only the current user's association; unsubscribe
// an unowned endpoint so enabling push will create a fresh one.
export async function reconcilePushSubscription(supabase: SupabaseClient, userId: string | null) {
  const subscription = await getPushSubscription();
  if (!subscription) return null;
  if (userId) {
    try {
      const { data, error } = await supabase.from("push_subscriptions")
        .select("endpoint")
        .eq("user_id", userId)
        .eq("endpoint", subscription.endpoint)
        .maybeSingle();
      if (error) throw error;
      if (data) return subscription;
    } catch (error) {
      await subscription.unsubscribe();
      throw error;
    }
  }
  await subscription.unsubscribe();
  return null;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { revokePushSubscription } from "./push-subscription";

export async function signOut(supabase: SupabaseClient): Promise<boolean> {
  try {
    await revokePushSubscription();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("[sign-out]", error);
    window.alert("Unable to sign out. Please try again.");
    return false;
  }
}

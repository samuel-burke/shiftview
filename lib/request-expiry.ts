// Time-off and shift-swap requests are about a specific store-local day, and
// only make sense decided before it. Once that day arrives (it is today or
// earlier in the store's timezone) a request still awaiting a decision has
// expired: the API leaves it out of every list and refuses to act on it, and
// the nightly /api/cron/expire-requests job deletes it. For the same reason a
// new request must be for a day after today.

// Whether a request for `date` (YYYY-MM-DD) has expired on the store day `todayKey`.
export function isRequestExpired(date: string, todayKey: string): boolean {
  return date.slice(0, 10) <= todayKey;
}

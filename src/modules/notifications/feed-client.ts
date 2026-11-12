import type { NotificationFeed } from "./feed";

export const NOTIFICATION_FEED_PATH = "/api/notifications";

/** With Realtime connected, a poll reloads only when the last load is older than this. */
const LIVE_POLL_MS = 5 * 60_000;

let running: Promise<NotificationFeed | null> | null = null;
let queued: Promise<NotificationFeed | null> | null = null;
let live = false;
let loadedAt = 0;

/** NotificationLive reports whether Realtime is connected (D-062). */
export function setNotificationsLive(connected: boolean): void {
  live = connected;
}

async function load(): Promise<NotificationFeed | null> {
  try {
    const response = await fetch(NOTIFICATION_FEED_PATH, { cache: "no-store", redirect: "manual" });
    if (!response.ok) return null;
    const feed = (await response.json()) as NotificationFeed;
    loadedAt = Date.now();
    return feed;
  } catch {
    // Offline or signed out: the caller keeps what it shows; the next poll retries.
    return null;
  }
}

function start(): Promise<NotificationFeed | null> {
  const request = load().finally(() => {
    if (running === request) running = null;
  });
  return request;
}

/**
 * The member's notifications (browser only). Components asking at the same
 * time share one request. `fresh` is for "something just changed": it never
 * returns a request that started before the call, it waits for one more.
 * `poll` is for timers, focus and navigation: while Realtime is connected it
 * skips the request (null) unless the last load is older than 5 minutes,
 * because a change is announced by Realtime anyway.
 * Null when skipped, offline, signed out or failed.
 */
export function fetchNotificationFeed({
  fresh = false,
  poll = false,
} = {}): Promise<NotificationFeed | null> {
  if (poll && !fresh && live && Date.now() - loadedAt < LIVE_POLL_MS) {
    return Promise.resolve(null);
  }
  if (!running) {
    running = start();
    return running;
  }
  if (!fresh) return running;
  queued ??= running.then(() => {
    queued = null;
    running = start();
    return running;
  });
  return queued;
}

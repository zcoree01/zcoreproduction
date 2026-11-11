import type { NotificationFeed } from "./feed";

export const NOTIFICATION_FEED_PATH = "/api/notifications";

let running: Promise<NotificationFeed | null> | null = null;
let queued: Promise<NotificationFeed | null> | null = null;

async function load(): Promise<NotificationFeed | null> {
  try {
    const response = await fetch(NOTIFICATION_FEED_PATH, { cache: "no-store", redirect: "manual" });
    if (!response.ok) return null;
    return (await response.json()) as NotificationFeed;
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
 * Null when offline, signed out or failed.
 */
export function fetchNotificationFeed({ fresh = false } = {}): Promise<NotificationFeed | null> {
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

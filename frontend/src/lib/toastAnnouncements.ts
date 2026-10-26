/**
 * Screen-reader channel for toasts.
 *
 * Sileo mounts its `aria-live` viewport only while a toast exists, and a live
 * region that arrives already holding text is announced unreliably. `toast`
 * (lib/toast.ts) therefore publishes every notice here, and `AppToaster` renders
 * it into two live regions that stay mounted for the life of the shell.
 */

export type AnnouncementPriority = 'polite' | 'assertive'

export interface Announcement {
  seq: number
  priority: AnnouncementPriority
  text: string
}

type Listener = (announcement: Announcement) => void

const listeners = new Set<Listener>()
let seq = 0

export function publishAnnouncement(priority: AnnouncementPriority, text: string): void {
  const announcement: Announcement = { seq: ++seq, priority, text }
  for (const listener of listeners) listener(announcement)
}

export function subscribeAnnouncements(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

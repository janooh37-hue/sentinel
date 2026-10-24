import type { BookDepartmentSendRead, BookDistributeRequest, SendPurpose } from './api'

export function distributionPayload(
  mode: BookDistributeRequest['mode'],
  userIds: number[],
  subdepartmentId: number | null,
  purpose: SendPurpose,
  note: string,
): BookDistributeRequest {
  return {
    mode,
    ...(mode === 'members' ? { user_ids: userIds } : {}),
    ...(mode === 'subdepartment' ? { subdepartment_id: subdepartmentId } : {}),
    purpose,
    note: note.trim() || null,
  }
}

/** Keep child deliveries immediately beneath their parent, even with partial history. */
export function orderDepartmentSends<T extends Pick<BookDepartmentSendRead, 'id' | 'parent_send_id'>>(sends: T[]): Array<{ send: T; depth: number }> {
  const children = new Map<number, T[]>()
  const ids = new Set(sends.map((send) => send.id))
  const visited = new Set<number>()
  const result: Array<{ send: T; depth: number }> = []
  for (const send of sends) {
    if (send.parent_send_id !== null) {
      const siblings = children.get(send.parent_send_id) ?? []
      siblings.push(send)
      children.set(send.parent_send_id, siblings)
    }
  }
  function visit(send: T, depth: number): void {
    if (visited.has(send.id)) return
    visited.add(send.id)
    result.push({ send, depth })
    for (const child of children.get(send.id) ?? []) visit(child, depth + 1)
  }
  for (const send of sends) if (send.parent_send_id === null || !ids.has(send.parent_send_id)) visit(send, 0)
  for (const send of sends) visit(send, 0)
  return result
}

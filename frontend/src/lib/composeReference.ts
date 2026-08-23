/** A record reference that can seed a compose handoff without UI dependencies. */
export type ComposeReference =
  | {
      kind: 'book'
      id: number
      label: string
      token: string
      /** Backing document id used by the classic Outlook bridge. */
      docId?: number
      /** Suggested attachment filename. */
      fileName?: string
      /** Optional subject employee, validated at handoff time when present. */
      employeeId?: string
    }
  | { kind: 'employee'; id: string; label: string; token: string }

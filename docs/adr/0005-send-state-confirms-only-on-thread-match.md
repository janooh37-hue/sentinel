---
status: proposed
---

# Send state's "confirmed" value only fires on a strict Message-ID thread match

Correspondence logging already matches an incoming email to a Record by
subject text or a reference number found in the subject (see
`correspondence_service._matching_category_id` and `email_service._resolve_book`).
We decided the new `Book.send_state` field must NOT reuse that heuristic to
auto-advance a Record to `confirmed`. Only an incoming email whose
In-Reply-To/References chain names the Message-ID of that Record's own
Outlook handoff — plus a real file attachment — may auto-confirm. Anything
weaker (subject/ref match only, no thread chain, or no attachment) parks in
the Scan Inbox as `awaiting_confirmation` for a person to approve, the same
bar a Scan-back match already applies to a reference match against the wrong
Paper date.

## Considered options

- Reuse the existing subject/ref-number match and auto-confirm on it: cheaper,
  but that heuristic is explicitly "weak evidence" even in its original
  (barcode) context — auto-confirming a Record as sent-and-received off it
  risks silently marking the wrong Record confirmed.
- Require a thread match AND an attachment before auto-confirming anything;
  everything else needs a human. This is the option taken.

## Consequences

- Replies that strip email headers, or that arrive as a fresh email instead
  of a reply, never auto-confirm — they fall to manual confirm in the Scan
  Inbox, same as a low-confidence Scan-back match does today.
- A Scan-back match (the physical paper re-scanned in-office) and a Threaded
  reply confirmation (the signed paper emailed back instead) are two
  independent paths to the same `confirmed` value; either one can fire first,
  and `send_state` never gates `approval_state` or vice versa.
- Duplicate attachments are already rejected by `ScanInbox.content_hash`
  before they reach a Record, so a scan-back that's later also emailed back
  does not double-file.

# Retain assignment access to reviewed revisions, not future contents

Status: accepted

Completed approval assignees retain read access without automatic expiry, but
only to revisions they were assigned; normal record permissions continue
independently. A whole-record exception would silently expose later revisions
to former assignees, while ending access immediately after completion prevents
them revisiting their work. Enforce revision boundaries in both response data
and document delivery, not merely in the interface. Only administrators with
users.manage may revoke retained revision access, with a recorded reason;
revocation removes that grant, not independent normal record permissions.
Record editors retain their existing authority to cancel pending reviewer
assignments.

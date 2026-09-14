"""Stateful IMAP fake for mailbox service and HTTP integration tests.

The fake models the external, already-authenticated connection boundary.  A
``FakeImapServer`` owns folders and messages while every connector call returns
a fresh ``FakeImapConnection`` session sharing that state.

Search and fetch identifiers are IMAP message sequence numbers.  This mirrors
the production service, which uses ordinary ``SEARCH``/``FETCH`` rather than
UID commands.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.db.models import EmailAccount

type ImapStatus = str | bytes
type ImapData = list[bytes | None]
type ImapResponse = tuple[ImapStatus, ImapData]
type ImapFetchItem = bytes | tuple[bytes, bytes] | None
type ImapFetchResponse = tuple[ImapStatus, list[ImapFetchItem]]
type SimpleOperation = Literal["noop", "list", "select", "search", "append", "create", "logout"]


@dataclass(frozen=True, slots=True)
class ImapOperation:
    """One observable command issued by a fake connection."""

    name: str
    args: tuple[object, ...] = ()


@dataclass(slots=True)
class FakeImapMessage:
    """One RFC822 message stored under its IMAP sequence number."""

    sequence_id: int
    internal_date: datetime
    raw: bytes
    flags: str | None = None
    appended_internal_date: str | None = None


@dataclass(slots=True)
class FakeImapFolder:
    name: str
    delimiter: str = "/"
    flags: tuple[str, ...] = ()
    messages: list[FakeImapMessage] = field(default_factory=list)

    @property
    def selectable(self) -> bool:
        return not any(flag.lower() == r"\noselect" for flag in self.flags)


class FakeImapServer:
    """Shared mailbox state and connector for fresh fake IMAP sessions."""

    def __init__(self) -> None:
        self.folders: dict[str, FakeImapFolder] = {}
        self.connections: list[FakeImapConnection] = []
        self.connection_accounts: list[EmailAccount] = []
        self.operations: list[ImapOperation] = []
        self.connect_outcomes: deque[Exception | None] = deque()
        self.simple_responses: dict[SimpleOperation, deque[ImapResponse | Exception]] = defaultdict(
            deque
        )
        self.fetch_responses: deque[ImapFetchResponse | Exception] = deque()

    def add_folder(
        self,
        name: str,
        *,
        delimiter: str = "/",
        flags: Iterable[str] = (),
    ) -> FakeImapFolder:
        folder = FakeImapFolder(name=name, delimiter=delimiter, flags=tuple(flags))
        self.folders[name] = folder
        return folder

    def add_message(
        self,
        folder: str,
        raw: bytes,
        *,
        internal_date: datetime | None = None,
        sequence_id: int | None = None,
        flags: str | None = None,
        appended_internal_date: str | None = None,
    ) -> FakeImapMessage:
        mailbox = self.folders.get(folder)
        if mailbox is None:
            mailbox = self.add_folder(folder)
        if sequence_id is None:
            sequence_id = max((message.sequence_id for message in mailbox.messages), default=0) + 1
        if any(message.sequence_id == sequence_id for message in mailbox.messages):
            raise ValueError(f"sequence number {sequence_id} already exists in folder {folder!r}")
        message = FakeImapMessage(
            sequence_id=sequence_id,
            internal_date=internal_date or datetime.now(UTC),
            raw=bytes(raw),
            flags=flags,
            appended_internal_date=appended_internal_date,
        )
        mailbox.messages.append(message)
        mailbox.messages.sort(key=lambda item: item.sequence_id)
        return message

    def queue_connect_failure(self, error: Exception) -> None:
        self.connect_outcomes.append(error)

    def queue_connect_success(self) -> None:
        """Reserve one successful connector call before a later queued failure."""
        self.connect_outcomes.append(None)

    def queue_response(
        self,
        operation: SimpleOperation,
        response: ImapResponse | Exception,
    ) -> None:
        self.simple_responses[operation].append(response)

    def queue_fetch_response(self, response: ImapFetchResponse | Exception) -> None:
        self.fetch_responses.append(response)

    def connector(self, account: EmailAccount) -> FakeImapConnection:
        """Record *account* and return a new logged-in session, or raise auth."""
        self.connection_accounts.append(account)
        if self.connect_outcomes:
            outcome = self.connect_outcomes.popleft()
            if outcome is not None:
                raise outcome
        connection = FakeImapConnection(self, account)
        self.connections.append(connection)
        return connection

    def _record(self, operation: ImapOperation) -> None:
        self.operations.append(operation)

    def _simple_override(self, operation: SimpleOperation) -> ImapResponse | None:
        queue = self.simple_responses[operation]
        if not queue:
            return None
        outcome = queue.popleft()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def _fetch_override(self) -> ImapFetchResponse | None:
        if not self.fetch_responses:
            return None
        outcome = self.fetch_responses.popleft()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeImapConnection:
    """One already-authenticated IMAP session backed by a fake server."""

    _SINCE = re.compile(r"^\(SINCE (?P<date>\d{2}-[A-Za-z]{3}-\d{4})\)$")

    def __init__(self, server: FakeImapServer, account: EmailAccount) -> None:
        self.server = server
        self.account = account
        self.selected_folder: str | None = None
        self.selected_readonly = False
        self.logged_out = False
        self.operations: list[ImapOperation] = []

    def _record(self, name: str, *args: object) -> None:
        if self.logged_out and name != "logout":
            raise RuntimeError("IMAP session is logged out")
        operation = ImapOperation(name=name, args=args)
        self.operations.append(operation)
        self.server._record(operation)

    @staticmethod
    def _mailbox_name(mailbox: str) -> str:
        if mailbox.startswith('"') and mailbox.endswith('"'):
            return mailbox[1:-1].replace(r"\"", '"').replace(r"\\", "\\")
        return mailbox

    def noop(self) -> ImapResponse:
        self._record("noop")
        return self.server._simple_override("noop") or ("OK", [b"NOOP completed"])

    def list(self) -> ImapResponse:
        self._record("list")
        override = self.server._simple_override("list")
        if override is not None:
            return override
        rows: ImapData = []
        for folder in self.server.folders.values():
            flags = " ".join(folder.flags)
            delimiter = folder.delimiter.replace("\\", "\\\\").replace('"', r"\"")
            name = folder.name.replace("\\", "\\\\").replace('"', r"\"")
            rows.append(f'({flags}) "{delimiter}" "{name}"'.encode())
        return "OK", rows

    def select(self, mailbox: str, readonly: bool = False) -> ImapResponse:
        self._record("select", mailbox, readonly)
        override = self.server._simple_override("select")
        if override is not None:
            return override
        name = self._mailbox_name(mailbox)
        folder = self.server.folders.get(name)
        if folder is None or not folder.selectable:
            return "NO", [b"mailbox unavailable"]
        self.selected_folder = name
        self.selected_readonly = readonly
        return "OK", [str(len(folder.messages)).encode()]

    def search(self, charset: None, criterion: str) -> ImapResponse:
        self._record("search", charset, criterion)
        override = self.server._simple_override("search")
        if override is not None:
            return override
        if self.selected_folder is None:
            return "NO", [b"no mailbox selected"]
        match = self._SINCE.fullmatch(criterion)
        if match is None:
            return "BAD", [b"unsupported search criterion"]
        since = datetime.strptime(match.group("date"), "%d-%b-%Y").date()
        folder = self.server.folders[self.selected_folder]
        sequence_ids = [
            str(message.sequence_id).encode()
            for message in folder.messages
            if message.internal_date.date() >= since
        ]
        return "OK", [b" ".join(sequence_ids)]

    def fetch(self, message_set: str, message_parts: str) -> ImapFetchResponse:
        self._record("fetch", message_set, message_parts)
        override = self.server._fetch_override()
        if override is not None:
            return override
        if self.selected_folder is None:
            return "NO", [b"no mailbox selected"]
        if message_parts != "(RFC822)":
            return "BAD", [b"unsupported message parts"]
        try:
            requested = [int(token) for token in message_set.split(",") if token]
        except ValueError:
            return "BAD", [b"invalid sequence set"]
        by_sequence = {
            message.sequence_id: message
            for message in self.server.folders[self.selected_folder].messages
        }
        response: list[ImapFetchItem] = []
        for sequence_id in requested:
            message = by_sequence.get(sequence_id)
            if message is None:
                continue
            response.append(
                (
                    f"{sequence_id} (RFC822 {{{len(message.raw)}}})".encode(),
                    message.raw,
                )
            )
            response.append(b")")
        return "OK", response

    def append(
        self,
        mailbox: str,
        flags: str,
        date_time: str,
        message: bytes,
    ) -> ImapResponse:
        self._record("append", mailbox, flags, date_time, bytes(message))
        override = self.server._simple_override("append")
        if override is not None:
            if _status_is_ok(override[0]):
                self.server.add_message(
                    self._mailbox_name(mailbox),
                    message,
                    flags=flags,
                    appended_internal_date=date_time,
                )
            return override
        name = self._mailbox_name(mailbox)
        if name not in self.server.folders:
            return "NO", [b"mailbox unavailable"]
        self.server.add_message(
            name,
            message,
            flags=flags,
            appended_internal_date=date_time,
        )
        return "OK", [b"APPEND completed"]

    def create(self, mailbox: str) -> ImapResponse:
        self._record("create", mailbox)
        override = self.server._simple_override("create")
        if override is not None:
            if _status_is_ok(override[0]):
                self.server.add_folder(self._mailbox_name(mailbox))
            return override
        name = self._mailbox_name(mailbox)
        if name in self.server.folders:
            return "NO", [b"mailbox already exists"]
        self.server.add_folder(name)
        return "OK", [b"CREATE completed"]

    def logout(self) -> ImapResponse:
        self._record("logout")
        self.logged_out = True
        override = self.server._simple_override("logout")
        return override or ("BYE", [b"LOGOUT completed"])


def _status_is_ok(status: ImapStatus) -> bool:
    if isinstance(status, bytes):
        status = status.decode("ascii", errors="ignore")
    return status.upper() == "OK"


__all__ = [
    "FakeImapConnection",
    "FakeImapFolder",
    "FakeImapMessage",
    "FakeImapServer",
    "ImapOperation",
]

"""WebDAV router for Word editing sessions.

Mounted at /dav/{token}/{filename:path} WITHOUT the auth_gate — the unguessable
token in the URL is the sole auth mechanism; Word's HTTP stack sends no cookies.

The :path converter lets filename be empty ("") so that collection requests
/dav/{token}/ (trailing slash, no filename) are handled here too.  Word sends
OPTIONS on the collection first; if that returns DAV headers Word treats the
file as writable.  Without a collection OPTIONS handler Word opens read-only.
"""

from __future__ import annotations

import hashlib
import logging
import os
from email.utils import formatdate
from typing import Annotated
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import word_session_repo

router = APIRouter()
log = logging.getLogger(__name__)

_DAV_METHODS = ["OPTIONS", "HEAD", "GET", "PUT", "LOCK", "UNLOCK", "PROPFIND"]

_OPTIONS_HEADERS = {
    "DAV": "1,2",
    "MS-Author-Via": "DAV",
    "Allow": "OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND",
}


def _propfind_names(body: bytes) -> list[str]:
    if not body:
        return []
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return []
    return [child.tag.rsplit("}", 1)[-1] for prop in root.iter("{DAV:}prop") for child in prop]


@router.api_route("/dav/{token}/{filename:path}", methods=_DAV_METHODS)
async def dav_handler(
    token: str,
    filename: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    method = request.method.upper()
    body = await request.body()
    event = {
        "dav_correlation": hashlib.sha256(token.encode()).hexdigest()[:12],
        "dav_method": method,
        "dav_path_shape": "collection" if filename == "" else "file",
        "dav_depth": request.headers.get("depth"),
        "dav_propfind_properties": _propfind_names(body) if method == "PROPFIND" else [],
        "dav_body_length": len(body),
        "dav_if_present": "if" in request.headers,
        "dav_lock_token_present": "lock-token" in request.headers,
    }

    def respond(response: Response, session_id: int | None = None) -> Response:
        log.info(
            "webdav_request",
            extra={
                **event,
                "dav_session_id": session_id,
                "dav_status": response.status_code,
                "dav_response_dav_present": "dav" in response.headers,
                "dav_response_lock_token_present": "lock-token" in response.headers,
                "dav_response_content_type_present": "content-type" in response.headers,
            },
        )
        return response

    # OPTIONS answers both file and collection paths — no token check needed.
    if method == "OPTIONS":
        return respond(Response(status_code=200, headers=_OPTIONS_HEADERS))

    # ------------------------------------------------------------------
    # Collection path  (/dav/{token}/ — filename is empty)
    # ------------------------------------------------------------------
    if filename == "":
        sess = word_session_repo.get_active_session_by_token(db, token)
        if sess is None:
            return respond(Response(status_code=404))

        if method == "PROPFIND":
            xml = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<D:multistatus xmlns:D="DAV:">'
                "<D:response>"
                f"<D:href>/dav/{token}/</D:href>"
                "<D:propstat><D:prop>"
                "<D:resourcetype><D:collection/></D:resourcetype>"
                f"<D:displayname>{token}</D:displayname>"
                "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
                "</D:response>"
                "</D:multistatus>"
            )
            return respond(
                Response(content=xml, media_type="application/xml", status_code=207), sess.id
            )

        return respond(Response(status_code=404), sess.id)

    # ------------------------------------------------------------------
    # File path  (/dav/{token}/{filename})
    # ------------------------------------------------------------------
    sess = word_session_repo.get_active_session_by_token(db, token)
    if sess is None:
        return respond(Response(status_code=404))

    path = sess.working_path

    # Guard: if working_path does not exist, return 404 before any read/write.
    if not os.path.exists(path):
        return respond(Response(status_code=404), sess.id)

    if method in ("GET", "HEAD"):
        return respond(FileResponse(path, filename=filename), sess.id)

    if method == "PUT":
        if not body:
            return respond(Response(status_code=400), sess.id)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)
        word_session_repo.record_put(db, sess.id)
        return respond(Response(status_code=204), sess.id)

    if method == "LOCK":
        # RFC 4918 §9.10: full activelock body; Lock-Token header uses angle-bracket form.
        lock_token_uri = f"opaquelocktoken:{token}"
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:prop xmlns:D="DAV:">'
            "<D:lockdiscovery>"
            "<D:activelock>"
            "<D:locktype><D:write/></D:locktype>"
            "<D:lockscope><D:exclusive/></D:lockscope>"
            "<D:depth>0</D:depth>"
            "<D:timeout>Second-3600</D:timeout>"
            f"<D:locktoken><D:href>{lock_token_uri}</D:href></D:locktoken>"
            f"<D:lockroot><D:href>/dav/{token}/{filename}</D:href></D:lockroot>"
            "</D:activelock>"
            "</D:lockdiscovery>"
            "</D:prop>"
        )
        return respond(
            Response(
                content=xml,
                media_type="application/xml",
                status_code=200,
                headers={"Lock-Token": f"<{lock_token_uri}>"},
            ),
            sess.id,
        )

    if method == "UNLOCK":
        return respond(Response(status_code=204), sess.id)

    if method == "PROPFIND":
        stat = os.stat(path)
        size = stat.st_size
        http_date = formatdate(stat.st_mtime, usegmt=True)
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:multistatus xmlns:D="DAV:">'
            "<D:response>"
            f"<D:href>/dav/{token}/{filename}</D:href>"
            "<D:propstat><D:prop>"
            f"<D:displayname>{filename}</D:displayname>"
            f"<D:getcontentlength>{size}</D:getcontentlength>"
            "<D:getcontenttype>application/vnd.openxmlformats-officedocument.wordprocessingml.document</D:getcontenttype>"
            f"<D:getlastmodified>{http_date}</D:getlastmodified>"
            "<D:resourcetype/>"
            "<D:supportedlock>"
            "<D:lockentry>"
            "<D:lockscope><D:exclusive/></D:lockscope>"
            "<D:locktype><D:write/></D:locktype>"
            "</D:lockentry>"
            "<D:lockentry>"
            "<D:lockscope><D:shared/></D:lockscope>"
            "<D:locktype><D:write/></D:locktype>"
            "</D:lockentry>"
            "</D:supportedlock>"
            "<D:lockdiscovery/>"
            "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            "</D:response>"
            "</D:multistatus>"
        )
        return respond(
            Response(content=xml, media_type="application/xml", status_code=207), sess.id
        )

    return respond(Response(status_code=405), sess.id)

"""WebDAV router for Word editing sessions.

Mounted at /dav/{token}/{filename:path} WITHOUT the auth_gate — the unguessable
token in the URL is the sole auth mechanism; Word's HTTP stack sends no cookies.

The :path converter lets filename be empty ("") so that collection requests
/dav/{token}/ (trailing slash, no filename) are handled here too.  Word sends
OPTIONS on the collection first; if that returns DAV headers Word treats the
file as writable.  Without a collection OPTIONS handler Word opens read-only.
"""

from __future__ import annotations

import os
from email.utils import formatdate
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import word_session_repo

router = APIRouter()

_DAV_METHODS = ["OPTIONS", "HEAD", "GET", "PUT", "LOCK", "UNLOCK", "PROPFIND"]

_OPTIONS_HEADERS = {
    "DAV": "1,2",
    "MS-Author-Via": "DAV",
    "Allow": "OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND",
}


@router.api_route("/dav/{token}/{filename:path}", methods=_DAV_METHODS)
async def dav_handler(
    token: str,
    filename: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    method = request.method.upper()

    # OPTIONS answers both file and collection paths — no token check needed.
    if method == "OPTIONS":
        return Response(status_code=200, headers=_OPTIONS_HEADERS)

    # ------------------------------------------------------------------
    # Collection path  (/dav/{token}/ — filename is empty)
    # ------------------------------------------------------------------
    if filename == "":
        sess = word_session_repo.get_active_session_by_token(db, token)
        if sess is None:
            return Response(status_code=404)

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
            return Response(content=xml, media_type="application/xml", status_code=207)

        return Response(status_code=404)

    # ------------------------------------------------------------------
    # File path  (/dav/{token}/{filename})
    # ------------------------------------------------------------------
    sess = word_session_repo.get_active_session_by_token(db, token)
    if sess is None:
        return Response(status_code=404)

    path = sess.working_path

    # Guard: if working_path does not exist, return 404 before any read/write.
    if not os.path.exists(path):
        return Response(status_code=404)

    if method in ("GET", "HEAD"):
        return FileResponse(path, filename=filename)

    if method == "PUT":
        body = await request.body()
        if not body:
            return Response(status_code=400)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)
        word_session_repo.record_put(db, sess.id)
        return Response(status_code=204)

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
        return Response(
            content=xml,
            media_type="application/xml",
            status_code=200,
            headers={"Lock-Token": f"<{lock_token_uri}>"},
        )

    if method == "UNLOCK":
        return Response(status_code=204)

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
        return Response(content=xml, media_type="application/xml", status_code=207)

    return Response(status_code=405)

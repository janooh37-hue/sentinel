"""WebDAV router for Word editing sessions.

Mounted at /dav/{token}/{filename} WITHOUT the auth_gate — the unguessable
token in the URL is the sole auth mechanism; Word's HTTP stack sends no cookies.
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


@router.api_route("/dav/{token}/{filename}", methods=_DAV_METHODS)
async def dav_handler(
    token: str,
    filename: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    method = request.method.upper()

    # OPTIONS doesn't need a valid token (Word probes capabilities first).
    if method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "DAV": "1,2",
                "MS-Author-Via": "DAV",
                "Allow": "OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND",
            },
        )

    sess = word_session_repo.get_active_session_by_token(db, token)
    if sess is None:
        return Response(status_code=404)

    path = sess.working_path

    if method in ("GET", "HEAD"):
        return FileResponse(path, filename=filename)

    if method == "PUT":
        body = await request.body()
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)
        word_session_repo.record_put(db, sess.id)
        return Response(status_code=204)

    if method == "LOCK":
        lock_token = f"<opaquelocktoken:{token}>"
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:prop xmlns:D="DAV:">'
            "<D:lockdiscovery>"
            "<D:activelock>"
            f"<D:locktoken><D:href>{lock_token}</D:href></D:locktoken>"
            "</D:activelock>"
            "</D:lockdiscovery>"
            "</D:prop>"
        )
        return Response(
            content=xml,
            media_type="application/xml",
            status_code=200,
            headers={"Lock-Token": lock_token},
        )

    if method == "UNLOCK":
        return Response(status_code=204)

    if method == "PROPFIND":
        stat = os.stat(path)
        size = stat.st_size
        # RFC 1123 date for getlastmodified
        http_date = formatdate(stat.st_mtime, usegmt=True)
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:multistatus xmlns:D="DAV:">'
            "<D:response>"
            f"<D:href>/dav/{token}/{filename}</D:href>"
            "<D:propstat><D:prop>"
            f"<D:displayname>{filename}</D:displayname>"
            f"<D:getcontentlength>{size}</D:getcontentlength>"
            f"<D:getlastmodified>{http_date}</D:getlastmodified>"
            "<D:resourcetype/>"
            "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            "</D:response>"
            "</D:multistatus>"
        )
        return Response(content=xml, media_type="application/xml", status_code=207)

    return Response(status_code=405)

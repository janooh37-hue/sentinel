"""Read schema for generated documents linked to employee records."""

from datetime import datetime

from app.schemas._base import ORMBase


class LinkedDocumentRead(ORMBase):
    """A committed generated Document attached to a leave/violation."""

    id: int
    template_id: str
    created_at: datetime

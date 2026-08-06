"""Context-default helper: today/weekday_ar/now_time — caller values win."""


def test_now_time_defaults_to_arabic_12_hour(monkeypatch) -> None:
    from datetime import datetime

    from app.core import docx_render

    class _Fixed(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 8, 5, 13, 5)

    monkeypatch.setattr(docx_render, "datetime", _Fixed)
    ctx: dict[str, object] = {}
    docx_render._apply_context_defaults(ctx)
    assert ctx["now_time"] == "1:05 م"


def test_now_time_caller_value_wins() -> None:
    from app.core import docx_render

    ctx: dict[str, object] = {"now_time": "9:30 ص"}
    docx_render._apply_context_defaults(ctx)
    assert ctx["now_time"] == "9:30 ص"

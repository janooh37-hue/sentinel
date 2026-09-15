"""Render the bilingual HTML bodies for account-mail links (verify / reset).

Every mail is bilingual regardless of the requested locale: the requested
language's section renders first, the other after an ``<hr>``, each wrapped
in a directional ``<div>`` so Arabic and English are equally first-class (no
placeholder / machine-translated copy). Every interpolated value is
``html.escape``-d — the recipient email never appears in the body, but the
link URL does, so this is a stored-content hygiene habit, not a live risk
today.

Never include a password, G-number, role, or account status in this mail —
only the one-time link and generic copy.
"""

from __future__ import annotations

import html

_SIGN_OFF_EN = "GSSG Manager · Account Security"
_SIGN_OFF_AR = "GSSG Manager · أمن الحساب"
_IGNORE_EN = "If you didn't request this, ignore this email."
_IGNORE_AR = "إذا لم تطلب هذا الإجراء، يرجى تجاهل هذه الرسالة."

_BUTTON_STYLE = (
    "display:inline-block;padding:10px 20px;background:#111827;color:#ffffff;"
    "text-decoration:none;border-radius:6px;font-weight:600"
)


def _normalize(locale: str) -> str:
    return "en" if locale == "en" else "ar"


def _section(
    *, lang: str, heading: str, why: str, url: str, expiry: str, ignore: str, sign_off: str
) -> str:
    dir_attr, lang_attr = ("rtl", "ar") if lang == "ar" else ("ltr", "en")
    safe_url = html.escape(url)
    return (
        f'<div dir="{dir_attr}" lang="{lang_attr}">'
        f"<h2>{html.escape(heading)}</h2>"
        f"<p>{html.escape(why)}</p>"
        f'<p><a href="{safe_url}" style="{_BUTTON_STYLE}">{html.escape(heading)}</a></p>'
        f"<p>{safe_url}</p>"
        f"<p>{html.escape(expiry)}</p>"
        f"<p>{html.escape(ignore)}</p>"
        f"<p>{html.escape(sign_off)}</p>"
        "</div>"
    )


def _render(
    *,
    locale: str,
    url: str,
    subject_en: str,
    subject_ar: str,
    heading_en: str,
    heading_ar: str,
    why_en: str,
    why_ar: str,
    expiry_en: str,
    expiry_ar: str,
) -> tuple[str, str]:
    lang = _normalize(locale)
    en_section = _section(
        lang="en",
        heading=heading_en,
        why=why_en,
        url=url,
        expiry=expiry_en,
        ignore=_IGNORE_EN,
        sign_off=_SIGN_OFF_EN,
    )
    ar_section = _section(
        lang="ar",
        heading=heading_ar,
        why=why_ar,
        url=url,
        expiry=expiry_ar,
        ignore=_IGNORE_AR,
        sign_off=_SIGN_OFF_AR,
    )
    first, second = (en_section, ar_section) if lang == "en" else (ar_section, en_section)
    subject = f"{subject_en} | {subject_ar}" if lang == "en" else f"{subject_ar} | {subject_en}"
    body = f"{first}<hr>{second}"
    return subject, body


def render_verification(url: str, locale: str) -> tuple[str, str]:
    """Render ``(subject, html)`` for the email-confirmation link."""
    return _render(
        locale=locale,
        url=url,
        subject_en="Confirm your GSSG Manager email",
        subject_ar="تأكيد بريدك الإلكتروني في GSSG Manager",
        heading_en="Confirm your email",
        heading_ar="تأكيد بريدك الإلكتروني",
        why_en=(
            "Confirm this address to finish your access request. An admin reviews "
            "your request after confirmation."
        ),
        why_ar=(
            "أكّد هذا العنوان لإتمام طلب الوصول الخاص بك. سيقوم أحد المسؤولين "
            "بمراجعة طلبك بعد التأكيد."
        ),
        expiry_en="This link expires in 24 hours.",
        expiry_ar="تنتهي صلاحية هذا الرابط خلال 24 ساعة.",
    )


def render_password_reset(url: str, locale: str) -> tuple[str, str]:
    """Render ``(subject, html)`` for the password-reset link."""
    return _render(
        locale=locale,
        url=url,
        subject_en="Reset your GSSG Manager password",
        subject_ar="إعادة تعيين كلمة مرور GSSG Manager",
        heading_en="Reset your password",
        heading_ar="إعادة تعيين كلمة المرور",
        why_en="Use this link to choose a new password.",
        why_ar="استخدم هذا الرابط لاختيار كلمة مرور جديدة.",
        expiry_en="This link expires in 30 minutes.",
        expiry_ar="تنتهي صلاحية هذا الرابط خلال 30 دقيقة.",
    )


__all__ = ["render_password_reset", "render_verification"]

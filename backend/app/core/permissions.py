"""Capability catalog + role-default presets — single source of truth.

Authorization is capability-based. A capability is a ``domain.action`` string
(e.g. ``settings.edit``). Roles (operator/manager/admin) are *presets*: each
maps to a default bundle of capabilities. An admin can then layer per-user
``grant``/``deny`` overrides on top (see ``services.perm_service``).

The admin role short-circuits to "all capabilities" so an admin can never lock
themselves out of user management.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE

SERVICE_CAP_PREFIX: Final[str] = "books.service."
SERVICE_RECORDS_CAP_PREFIX: Final[str] = "books.servicerecords."
CATEGORY_CAP_PREFIX: Final[str] = "books.category."
SERVICE_CAPABILITY_IDS: Final[frozenset[str]] = frozenset(
    f"{SERVICE_CAP_PREFIX}{service_id}" for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
)
SERVICE_RECORDS_CAPABILITY_IDS: Final[frozenset[str]] = frozenset(
    f"{SERVICE_RECORDS_CAP_PREFIX}{service_id}" for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
)


@dataclass(frozen=True, slots=True)
class Capability:
    """Static capability metadata and request policy."""

    id: str
    domain: str
    label_en: str
    label_ar: str
    description_en: str
    description_ar: str
    sensitive: bool = False
    requestable: bool = True


# ─── Catalog ──────────────────────────────────────────────────────────────────
# Ordered by domain so the admin matrix can render collapsible domain groups.
# ``app.access`` is the baseline every signed-in user gets (dashboard, template
# field lists, managers list, system/info — the read-only chrome).

CAPABILITIES: Final[tuple[Capability, ...]] = (
    Capability(
        "app.access",
        "app",
        "Access the app",
        "الوصول إلى التطبيق",
        "Sign in and see the dashboard, document fields, and read-only chrome.",
        "تسجيل الدخول وعرض لوحة المعلومات وحقول المستندات والعناصر للقراءة فقط.",
    ),
    Capability(
        "employees.view",
        "employees",
        "View employees",
        "عرض الموظفين",
        "See the employee directory and individual employee records.",
        "عرض دليل الموظفين وسِجلاتهم الفردية.",
    ),
    Capability(
        "employees.create",
        "employees",
        "Create employees",
        "إضافة موظفين",
        "Add new employees to the directory.",
        "إضافة موظفين جدد إلى الدليل.",
    ),
    Capability(
        "employees.edit",
        "employees",
        "Edit employee profiles",
        "تعديل بيانات الموظفين",
        "Edit profiles, photos, signature, and passport data.",
        "تعديل البيانات والصور والتوقيع وبيانات جواز السفر.",
    ),
    Capability(
        "employees.vault.manage",
        "employees",
        "Manage document vaults",
        "إدارة خزنة المستندات",
        "Upload and organise files inside employee vaults.",
        "رفع الملفات وتنظيمها داخل خزنة الموظف.",
    ),
    Capability(
        "employees.notify",
        "employees",
        "Notify employees",
        "إشعار الموظفين",
        "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, duty resumptions, and violations.",
        "إرسال تأكيدات عبر واتساب (مع بديل الرسائل النصية) للإجازات واستئناف المناوبة والمخالفات.",
    ),
    Capability(
        "expiry.view",
        "expiry",
        "View expiry",
        "عرض انتهاء الصلاحية",
        "See the document-expiry board.",
        "عرض لوحة انتهاء صلاحية المستندات.",
    ),
    Capability(
        "leaves.view",
        "leaves",
        "View leaves",
        "عرض الإجازات",
        "See leave records and their status.",
        "عرض سِجلات الإجازات وحالتها.",
    ),
    Capability(
        "timesheet.view",
        "timesheet",
        "View the time sheet",
        "عرض كشف الحضور",
        "See the monthly attendance grid and download the sheets.",
        "عرض شبكة الحضور الشهرية وتنزيل الكشوف.",
    ),
    Capability(
        "timesheet.edit",
        "timesheet",
        "Correct and close the time sheet",
        "تصحيح وإغلاق كشف الحضور",
        "Mark absence, correct cells, set the post count, and close or reopen a month.",
        "تسجيل الغياب وتصحيح الخلايا وضبط عدد النقاط وإغلاق الشهر أو إعادة فتحه.",
    ),
    Capability(
        "leaves.create",
        "leaves",
        "Create leaves",
        "تسجيل إجازات",
        "Record new leave requests.",
        "تسجيل طلبات إجازة جديدة.",
    ),
    Capability(
        "leaves.edit",
        "leaves",
        "Edit leaves",
        "تعديل الإجازات",
        "Amend leaves, attach certificates, and record duty returns.",
        "تعديل الإجازات وإرفاق الشهادات وتسجيل استئناف المناوبة.",
    ),
    Capability(
        "leaves.delete",
        "leaves",
        "Delete leaves",
        "حذف الإجازات",
        "Remove leave records.",
        "حذف سِجلات الإجازات.",
    ),
    Capability(
        "violations.view",
        "violations",
        "View violations",
        "عرض المخالفات",
        "See recorded violations.",
        "عرض المخالفات المسجَّلة.",
    ),
    Capability(
        "violations.create",
        "violations",
        "Create violations",
        "تسجيل مخالفات",
        "Record new violations.",
        "تسجيل مخالفات جديدة.",
    ),
    Capability(
        "violations.edit",
        "violations",
        "Edit violations",
        "تعديل المخالفات",
        "Correct violation details.",
        "تصحيح تفاصيل المخالفة.",
    ),
    Capability(
        "violations.delete",
        "violations",
        "Delete violations",
        "حذف المخالفات",
        "Remove violations.",
        "حذف المخالفات.",
    ),
    Capability(
        "documents.generate",
        "documents",
        "Generate documents",
        "إنشاء المستندات",
        "Create official documents from templates.",
        "إنشاء مستندات رسمية من القوالب.",
    ),
    Capability(
        "documents.scan",
        "documents",
        "Scan documents with OCR",
        "مسح المستندات بالتعرّف الضوئي",
        "Upload scans and run OCR to import documents.",
        "رفع المسحات وتشغيل التعرّف الضوئي على الحروف لاستيراد المستندات.",
    ),
    Capability(
        "books.view",
        "books",
        "View records",
        "عرض السجلات",
        "Browse the records register.",
        "تصفّح سجل السجلات.",
    ),
    Capability(
        "books.create",
        "books",
        "Create records",
        "إنشاء سجلات",
        "Start new records from forms or templates.",
        "بدء سجلات جديدة من النماذج أو القوالب.",
    ),
    Capability(
        "books.edit",
        "books",
        "Edit records & attachments",
        "تعديل السجلات والمرفقات",
        "Edit fields, reviewers, attachments, and file scan-backs.",
        "تعديل الحقول والمراجعين والمرفقات وإيداع مسحات الكشف.",
    ),
    Capability(
        "books.submit",
        "books",
        "Submit for approval",
        "إرسال للاعتماد",
        "Send records into the approval chain.",
        "إرسال السجلات إلى مسار الاعتماد.",
    ),
    Capability(
        "books.approve",
        "books",
        "Approve / reject records",
        "اعتماد / رفض السجلات",
        "Approve, sign, or reject documents in the approval queue.",
        "اعتماد أو توقيع أو رفض المستندات في قائمة الانتظار.",
    ),
    Capability(
        "books.override_state",
        "books",
        "Force a record's state",
        "فرض حالة السجل",
        "Set any record to any state — draft, awaiting signature, awaiting scan, approved, returned, rejected, or voided — bypassing the approval chain. Admin-grade: it overrides who signed what.",
        "ضبط أي سجل على أي حالة — مسودة أو بانتظار توقيع أو بانتظار مسح أو معتمد أو مرتجع أو مرفوض أو ملغى — بتخطّي مسار الاعتماد. من رتبة المسؤول: يتجاوز من وقّع وماذا.",
    ),
    Capability(
        "books.templates",
        "books",
        "Manage Word templates",
        "إدارة قوالب وورد",
        "Edit the shared Word templates records are composed from.",
        "تعديل قوالب وورد المشتركة التي تُصاغ منها السجلات.",
    ),
    Capability(
        "books.delete",
        "books",
        "Delete records",
        "حذف السجلات",
        "Move records to the bin.",
        "نقل السجلات إلى المحذوفات.",
    ),
    Capability(
        "permits.view",
        "permits",
        "View security permits",
        "عرض تصاريح الدخول",
        "See the security-zone entry-permit register and its status.",
        "عرض سجل تصاريح دخول المناطق الأمنية وحالتها.",
    ),
    Capability(
        "permits.create",
        "permits",
        "Issue permits",
        "إصدار التصاريح",
        "Register new security-zone entry permits.",
        "تسجيل تصاريح دخول جديدة للمناطق الأمنية.",
    ),
    Capability(
        "permits.edit",
        "permits",
        "Amend & renew permits",
        "تعديل التصاريح وتجديدها",
        "Edit people, vehicles, and documents; renew permits.",
        "تعديل الأشخاص والمركبات والمستندات وتجديد التصاريح.",
    ),
    Capability(
        "permits.revoke",
        "permits",
        "Revoke permits",
        "إلغاء التصاريح",
        "Revoke active entry permits.",
        "إلغاء التصاريح النشطة.",
    ),
    Capability(
        "permits.delete",
        "permits",
        "Delete permits",
        "حذف التصاريح",
        "Remove permit records.",
        "حذف سِجلات التصاريح.",
    ),
    Capability(
        "vehicles.view",
        "vehicles",
        "View vehicles",
        "عرض المركبات",
        "See the fleet hub, vehicle files, fines, accidents, maintenance, and reports.",
        "عرض مركز الأسطول وملفات المركبات والمخالفات والحوادث والصيانة والتقارير.",
    ),
    Capability(
        "vehicles.edit",
        "vehicles",
        "Manage vehicles",
        "إدارة المركبات",
        "Add and renew vehicles, manage sites, record fines, accidents, maintenance and photos, fetch fines from EVG, and generate vehicle letters.",
        "إضافة المركبات وتجديدها وإدارة المواقع وتسجيل المخالفات والحوادث والصيانة والصور وجلب المخالفات من بوابة المركبات وإنشاء خطابات المركبات.",
    ),
    Capability(
        "vehicles.delete",
        "vehicles",
        "Delete vehicle records",
        "حذف سجلات المركبات",
        "Delete fines, accidents, maintenance rows, and gallery photos.",
        "حذف المخالفات والحوادث وسجلات الصيانة وصور المعرض.",
    ),
    Capability(
        "ledger.view",
        "ledger",
        "View ledger",
        "عرض سجل المراسلات",
        "Read correspondence ledger entries.",
        "قراءة قيود سجل المراسلات.",
    ),
    Capability(
        "ledger.create",
        "ledger",
        "Create entries, contacts & recipient lists",
        "إنشاء القيود وجهات الاتصال وقوائم المستلمين",
        "Create ledger entries, contacts, and recipient lists.",
        "إنشاء قيود السجل وجهات الاتصال وقوائم المستلمين.",
    ),
    Capability(
        "ledger.edit",
        "ledger",
        "Edit entries & address book",
        "تعديل القيود وجهات الاتصال",
        "Edit entries and lists, flag, star, and attach files.",
        "تعديل القيود والقوائم والتمييز والإسناد النجمي وإرفاق الملفات.",
    ),
    Capability(
        "ledger.send",
        "ledger",
        "Hand off email to Outlook",
        "تسليم البريد إلى Outlook",
        "Hand off email to Outlook or push prepared drafts to your Outlook Drafts folder.",
        "سلّم البريد إلى Outlook أو ادفع المسودات الجاهزة إلى مجلد مسودات Outlook.",
    ),
    Capability(
        "ledger.delete",
        "ledger",
        "Delete entries, contacts & recipient lists",
        "حذف القيود وجهات الاتصال وقوائم المستلمين",
        "Remove ledger entries, contacts, and recipient lists.",
        "حذف قيود السجل وجهات الاتصال وقوائم المستلمين.",
    ),
    Capability(
        "email.manage",
        "email",
        "Manage your mailbox",
        "إدارة صندوق بريدك",
        "Link and sync your own mailbox.",
        "ربط صندوق بريدك ومزامنته.",
    ),
    Capability(
        "settings.view",
        "settings",
        "View settings",
        "عرض الإعدادات",
        "See application settings.",
        "عرض إعدادات التطبيق.",
    ),
    Capability(
        "settings.edit",
        "settings",
        "Change settings",
        "تغيير الإعدادات",
        "Change application settings.",
        "تغيير إعدادات التطبيق.",
    ),
    Capability(
        "submitters.manage",
        "submitters",
        "Manage submitters",
        "إدارة مقدّمي الطلبات",
        "Manage the list of document submitters.",
        "إدارة قائمة مقدّمي المستندات.",
    ),
    Capability(
        "editor_templates.manage",
        "editor_templates",
        "Manage editor templates",
        "إدارة قوالب المحرر",
        "Create and edit document editor templates.",
        "إنشاء وتعديل قوالب محرر المستندات.",
    ),
    Capability(
        "users.manage",
        "users",
        "Manage users + permissions",
        "إدارة المستخدمين + الصلاحيات",
        "Manage user accounts and their permissions (admin-only).",
        "إدارة حسابات المستخدمين وصلاحياتهم (للمسؤول فقط).",
        sensitive=True,
        requestable=False,
    ),
    Capability(
        "messages.broadcast",
        "messages",
        "Send group announcements",
        "إرسال إعلانات للمجموعات",
        "Post announcements (text or a document) to WhatsApp groups.",
        "نشر إعلانات نصية أو مستندات إلى مجموعات واتساب.",
    ),
    Capability(
        "workforce.self.view",
        "workforce",
        "View own workforce record",
        "عرض سجلّك في القوى العاملة",
        "View your own schedule, attendance punches, and leave.",
        "عرض جدولك وبطاقات حضورك وإجازاتك الخاصة.",
    ),
    Capability(
        "workforce.dashboard.view",
        "workforce",
        "View workforce dashboard",
        "عرض لوحة القوى العاملة",
        "View aggregate workforce dashboard data inside assigned scope.",
        "عرض بيانات لوحة القوى العاملة الإجمالية ضمن النطاق المسند إليك.",
    ),
    Capability(
        "workforce.people.view",
        "workforce",
        "View workforce people",
        "عرض منتسبي القوى العاملة",
        "View roster and attendance details inside assigned scope.",
        "عرض الكشف وتفاصيل الحضور ضمن النطاق المسند.",
    ),
    Capability(
        "workforce.schedule.manage",
        "workforce",
        "Manage workforce schedules",
        "إدارة الجداول",
        "Manage crews, rotations, memberships, and schedule overrides.",
        "إدارة الفرق والدورة والعضويات وتجاوزات الجدول.",
    ),
    Capability(
        "workforce.policy.manage",
        "workforce",
        "Manage workforce policies",
        "إدارة السياسات",
        "Manage staffing requirements, attendance policies, and excusing leave kinds.",
        "إدارة متطلبات التوظيف وسياسات الحضور وأنواع الإجازات المستثناة.",
    ),
    Capability(
        "workforce.attendance.review",
        "workforce",
        "Review workforce attendance",
        "مراجعة الحضور",
        "Review workforce attendance cases, exceptions, and source facts.",
        "مراجعة حالات الحضور والاستثناءات والبيانات المصدرية.",
    ),
    Capability(
        "workforce.attendance.correct",
        "workforce",
        "Correct workforce attendance",
        "تصحيح الحضور",
        "Create audited workforce attendance adjustments.",
        "إنشاء تعديلات حضور مُدقَّقة ومسجَّلة.",
    ),
    Capability(
        "workforce.integration.manage",
        "workforce",
        "Manage workforce integration",
        "إدارة تكامل القوى العاملة",
        "Manage workforce provider status, mappings, tests, and synchronization.",
        "إدارة حالة مزوّد القوى العاملة والربط واختبارات المزامنة.",
    ),
    Capability(
        "system.admin",
        "system",
        "Admin key + v3 migration",
        "مفتاح المسؤول + ترحيل الإصدار الثالث",
        "Use the admin key and run system/migration tools (admin-only).",
        "استخدام مفتاح المسؤول وتشغيل أدوات النظام والترحيل (للمسؤول فقط).",
        sensitive=True,
        requestable=False,
    ),
)

CAPABILITY_IDS: Final[frozenset[str]] = frozenset(c.id for c in CAPABILITIES)
SENSITIVE_CAPABILITY_IDS: Final[frozenset[str]] = frozenset(
    c.id for c in CAPABILITIES if c.sensitive
)

# Convenience: the complete set (what the admin preset resolves to).
ALL_CAPABILITIES: Final[frozenset[str]] = CAPABILITY_IDS


# ─── Role presets ───────────────────────────────────────────────────────────────
# Operator: read-only across the app + the daily-work write surfaces (document
# generation, ledger entries, and Outlook handoff, including entry deletion —
# ledger.delete was held pre-split and is preserved).
# Manager: adds the management writes. Admin: everything.
_OPERATOR_CAPS: Final[frozenset[str]] = frozenset(
    {
        "app.access",
        "employees.view",
        "expiry.view",
        "leaves.view",
        "timesheet.view",
        "violations.view",
        "documents.generate",
        "documents.scan",
        "books.view",
        "permits.view",
        "ledger.view",
        "ledger.create",
        "ledger.edit",
        "ledger.send",
        "ledger.delete",
        "email.manage",
        "settings.view",
        "workforce.self.view",
    }
)

# Atomic equivalents of the old bundled manager grants, plus the newer
# per-domain grants upstream presets carry (timesheet). Workforce is
# intentionally absent: it always needs an explicit grant + scope.
_MANAGER_EXTRA: Final[frozenset[str]] = frozenset(
    {
        "employees.create",
        "employees.edit",
        "employees.vault.manage",
        "employees.notify",
        "leaves.create",
        "leaves.edit",
        "leaves.delete",
        "violations.create",
        "violations.edit",
        "violations.delete",
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
        "books.approve",
        "permits.create",
        "permits.edit",
        "permits.revoke",
        "permits.delete",
        "ledger.delete",
        "submitters.manage",
        "editor_templates.manage",
        "timesheet.edit",
    }
)

_MANAGER_CAPS: Final[frozenset[str]] = (_OPERATOR_CAPS | _MANAGER_EXTRA) - frozenset(
    {"workforce.self.view"}
)

ROLE_DEFAULTS: Final[dict[str, frozenset[str]]] = {
    OPERATOR_ROLE: _OPERATOR_CAPS,
    MANAGER_ROLE: _MANAGER_CAPS,
    ADMIN_ROLE: ALL_CAPABILITIES,
}


def default_caps_for_role(role: str) -> frozenset[str]:
    """Role-preset capability bundle. Unknown roles get the operator default."""
    return ROLE_DEFAULTS.get(role, _OPERATOR_CAPS)


__all__ = [
    "ALL_CAPABILITIES",
    "CAPABILITIES",
    "CAPABILITY_IDS",
    "CATEGORY_CAP_PREFIX",
    "ROLE_DEFAULTS",
    "SENSITIVE_CAPABILITY_IDS",
    "SERVICE_CAPABILITY_IDS",
    "SERVICE_CAP_PREFIX",
    "SERVICE_RECORDS_CAPABILITY_IDS",
    "SERVICE_RECORDS_CAP_PREFIX",
    "Capability",
    "default_caps_for_role",
]

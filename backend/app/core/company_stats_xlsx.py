"""Render scoped company attendance facts as a bilingual Excel workbook."""

from __future__ import annotations

import re
from datetime import date
from io import BytesIO
from math import floor
from typing import TYPE_CHECKING, Literal

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.schemas.workforce import COMPANY_STATS_UNASSIGNED

if TYPE_CHECKING:
    from app.schemas.workforce import CompanyStatsRead, StatsTotals

type WorkbookLanguage = Literal["ar", "en"]
type CellValue = date | str | int | float | None

# Shared with the stats service so payload keys and workbook columns stay in sync.
LEAVE_KINDS = ("annual", "administrative", "sick", "duty", "national_service", "other")
RATIO_METRICS = ("absence", "single_punch", "late")

# Match shared labels in frontend/src/locales/{en,ar}.json (companyStats); the
# workbook also needs standalone column labels where the page uses a sentence.
_COPY = {
    "title": ("Company statistics", "إحصائيات السرايا"),
    "summary": ("Period summary", "ملخص الفترة"),
    "companies": ("Companies", "السرايا"),
    "trend": ("Trend over time", "الاتجاه عبر الزمن"),
    "ranking": ("Most frequent exceptions", "الأكثر تكرارًا"),
    "national_service": ("National Service", "الخدمة الوطنية"),
    "all": ("All companies", "جميع السرايا"),
    "company": ("Company", "السرية"),
    "unassigned": ("Unassigned", "غير محدد"),
    "metric": ("Metric", "المقياس"),
    "current": ("Current period", "الفترة الحالية"),
    "previous": ("Previous period", "الفترة السابقة"),
    "delta": ("Change", "التغيّر"),
    "not_enough": ("Not enough earlier data", "لا توجد بيانات سابقة كافية"),
    "from": ("From", "من"),
    "to": ("To", "إلى"),
    "period_days": ("Calendar days", "الأيام التقويمية"),
    "strength": ("Strength", "القوة"),
    "scheduled": ("Scheduled duties", "التكليفات المجدولة"),
    "excused": ("Excused duties", "التكليفات المعفاة"),
    "due": ("Due duties", "التكليفات المستحقة"),
    "pending": ("Pending judgment", "بانتظار التقييم"),
    "absence": ("Absence", "غياب"),
    "days": ("Days", "بالأيام"),
    "episodes": ("Episodes", "بالحالات"),
    "count": ("Occurrences", "بعدد المرات"),
    "single_punch": ("Single punch", "بصمة واحدة"),
    "late": ("Late", "تأخير"),
    "late_minutes": ("Minutes past grace", "الدقائق بعد السماح"),
    "rate": ("Absence rate", "نسبة الغياب"),
    "annual": ("Annual leave", "إجازة سنوية"),
    "administrative": ("Administrative leave", "إجازة إدارية"),
    "sick": ("Sick leave", "إجازة مرضية"),
    "sick_days": ("Sick days", "أيام مرضية"),
    "duty": ("Official mission", "مهمة رسمية"),
    "other": ("Other leave (compassionate, emergency, Hajj)", "إجازات أخرى (تعزية، طارئة، حج)"),
    "exit_permits": ("Exit permits", "تصاريح الخروج"),
    "requested_hours": ("Hours requested", "الساعات المطلوبة"),
    "with_hours": ("Permits with hours", "تصاريح محددة الساعات"),
    "ratio": ("Ratio per person", "النسبة لكل فرد"),
    "status": ("Status", "الحالة"),
    "good": ("Better than average", "أفضل من المعدل"),
    "normal": ("Within average", "ضمن المعدل"),
    "warn": ("Above average", "فوق المعدل"),
    "bad": ("Needs intervention", "يحتاج تدخل"),
    "small": ("Small sample", "عينة صغيرة"),
    "no_comparison": ("No comparison", "لا مقارنة"),
    "total": ("Total", "المجموع"),
    "employee_id": ("Employee ID", "رقم الموظف"),
    "employee": ("Employee", "الموظف"),
    "position": ("Position", "المسمى الوظيفي"),
    "shift": ("Shift", "الوردية"),
    "shift_morning": ("Morning", "الصباحية"),
    "shift_noon": ("Noon", "الظهيرة"),
    "shift_night": ("Night", "الليلية"),
    "shift_office_day": ("Office", "الدوام الرسمي"),
    "leave": ("Leave", "الإجازات"),
    "events": ("Exceptions", "المخالفات"),
    "score": ("Score", "المؤشر"),
    "tier": ("Tier", "المستوى"),
    "transfer_from": ("Transferred from", "منقول من"),
    "transfer_to": ("Transferred to", "منقول إلى"),
    "transfer_on": ("Transfer date", "تاريخ النقل"),
    "return": ("Return date", "تاريخ العودة"),
    "remaining": ("Days remaining", "الأيام المتبقية"),
    "progress": ("Service progress", "تقدم الخدمة الوطنية"),
    "service_days": (
        "National Service absence days in the period",
        "أيام الغياب بسبب الخدمة خلال الفترة",
    ),
}
_TOTAL_KEYS = (
    "strength",
    "scheduled",
    "excused",
    "due",
    "pending",
    "absence.days",
    "absence.episodes",
    "single_punch",
    "late",
    "late_minutes",
    "rate",
    *(f"{leave}.{measure}" for leave in LEAVE_KINDS for measure in ("days", "count")),
    "exit_permits",
    "requested_hours",
    "with_hours",
)
_HEADER_FILL = PatternFill(fill_type="solid", fgColor="0D2845")
_HEADER_FONT = Font(name="Arial", size=11, bold=True, color="FFFFFF")
_BODY_FONT = Font(name="Arial", size=11)
_SUBTOTAL_FILL = PatternFill(fill_type="solid", fgColor="E8EDF3")
_SUBTOTAL_FONT = Font(name="Arial", size=11, bold=True, color="0D2845")
_HEADER_ALIGNMENT = Alignment(vertical="center", wrap_text=True)
_DATE_FORMAT = "yyyy-mm-dd"
_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')


def _label(key: str, language: WorkbookLanguage) -> str:
    index = 1 if language == "ar" else 0
    return " · ".join(_COPY[part][index] for part in key.split("."))


def _unit_label(unit: str | None, language: WorkbookLanguage) -> str:
    return unit if unit and unit != COMPANY_STATS_UNASSIGNED else _label("unassigned", language)


def _scope_label(unit: str | None, language: WorkbookLanguage) -> str:
    return _label("all", language) if unit is None else _unit_label(unit, language)


def _shift_label(shift: str | None, language: WorkbookLanguage) -> str | None:
    if shift is not None and (key := f"shift_{shift}") in _COPY:
        return _label(key, language)
    return shift


def _preferred(en: str | None, ar: str | None, language: WorkbookLanguage) -> str | None:
    return (ar or en) if language == "ar" else (en or ar)


def _append(sheet: Worksheet, values: tuple[CellValue, ...], *, subtotal: bool = False) -> int:
    sheet.append(
        tuple(
            ILLEGAL_CHARACTERS_RE.sub("", value) if isinstance(value, str) else value
            for value in values
        )
    )
    row: int = sheet.max_row
    for index, value in enumerate(values, start=1):
        cell = sheet.cell(row, index)
        cell.font = _SUBTOTAL_FONT if subtotal else _BODY_FONT
        if subtotal:
            cell.fill = _SUBTOTAL_FILL
        if isinstance(value, str):
            # Treat employee names and snapshot labels as text, never formulas.
            cell.data_type = "s"
        elif isinstance(value, date):
            cell.number_format = _DATE_FORMAT
        elif isinstance(value, int):
            cell.number_format = "0"
        elif isinstance(value, float):
            cell.number_format = "0.00"
    return row


def _sheet(
    workbook: Workbook,
    key: str,
    columns: tuple[str, ...],
    language: WorkbookLanguage,
    *,
    widths: tuple[int, ...],
    freeze: str = "A2",
) -> Worksheet:
    sheet = workbook.create_sheet(_label(key, language))
    sheet.sheet_view.rightToLeft = language == "ar"
    sheet.freeze_panes = freeze
    sheet.row_dimensions[1].height = 30
    for index, (column, width) in enumerate(zip(columns, widths, strict=True), start=1):
        cell = sheet.cell(1, index, _label(column, language))
        cell.font, cell.fill, cell.alignment = _HEADER_FONT, _HEADER_FILL, _HEADER_ALIGNMENT
        sheet.column_dimensions[get_column_letter(index)].width = width
    return sheet


def _totals_values(totals: StatsTotals) -> tuple[int | float | None, ...]:
    leaves = totals.leaves
    permits = leaves.exit_permits
    return (
        totals.strength,
        totals.duties_scheduled,
        totals.duties_excused,
        totals.duties_due,
        totals.duties_pending,
        totals.absence.days,
        totals.absence.episodes,
        totals.single_punch,
        totals.late.count,
        totals.late.minutes,
        totals.absence_rate / 100 if totals.absence_rate is not None else None,
        *(
            value
            for leave in (
                leaves.annual,
                leaves.administrative,
                leaves.sick,
                leaves.duty,
                leaves.national_service,
                leaves.other,
            )
            for value in (leave.days, leave.count)
        ),
        permits.count,
        permits.hours,
        permits.with_hours,
    )


def _delta(current: int | float | None, previous: int | float | None) -> float | None:
    if current is None or not previous:
        return None
    # Match the on-screen whole-percent rounding while keeping a numeric cell.
    return floor(((current - previous) / previous) * 100 + 0.5) / 100


def _summary(workbook: Workbook, stats: CompanyStatsRead, language: WorkbookLanguage) -> None:
    comparable = stats.previous_comparable
    columns = (
        ("metric", "current", "previous", "delta")
        if comparable
        else ("metric", "current", "previous")
    )
    sheet = _sheet(
        workbook,
        "summary",
        columns,
        language,
        widths=(43, 25, 25, 16) if comparable else (43, 25, 25),
    )
    period, previous = stats.period, stats.previous_period
    _append(sheet, (_label("from", language), period.from_date, previous.from_date))
    _append(sheet, (_label("to", language), period.to_date, previous.to_date))
    _append(sheet, (_label("period_days", language), period.days, previous.days))
    _append(sheet, (_label("company", language), _scope_label(stats.duty_unit, language)))
    if not comparable:
        row = _append(sheet, (_label("not_enough", language),), subtotal=True)
        sheet.merge_cells(start_row=row, end_row=row, start_column=1, end_column=3)
    for key, now, earlier in zip(
        _TOTAL_KEYS,
        _totals_values(stats.summary.current),
        _totals_values(stats.summary.previous),
        strict=True,
    ):
        row = _append(
            sheet,
            (_label(key, language), now, earlier, _delta(now, earlier))
            if comparable
            else (_label(key, language), now, earlier),
        )
        if key == "rate":
            sheet.cell(row, 2).number_format = sheet.cell(row, 3).number_format = "0.0%"
        if comparable:
            sheet.cell(row, 4).number_format = "0%"


def _companies(workbook: Workbook, stats: CompanyStatsRead, language: WorkbookLanguage) -> None:
    columns = (
        "company",
        "shift",
        *_TOTAL_KEYS,
        *(f"{key}.ratio" for key in RATIO_METRICS),
        "status",
    )
    sheet = _sheet(
        workbook,
        "companies",
        columns,
        language,
        widths=(24, 24, *(16 for _ in _TOTAL_KEYS), 20, 20, 20, 24),
        freeze="C2",
    )
    rate_column = columns.index("rate") + 1
    for company in stats.companies:
        status_key = "small" if company.small_sample else company.status.overall or "no_comparison"
        row = _append(
            sheet,
            (
                _unit_label(company.duty_unit, language),
                ", ".join(_shift_label(code, language) or "" for code in company.shift_codes),
                *_totals_values(company.totals),
                company.ratio.absence,
                company.ratio.single_punch,
                company.ratio.late,
                _label(status_key, language),
            ),
        )
        sheet.cell(row, rate_column).number_format = "0.0%"
    total_row = _append(
        sheet, (_label("total", language), None, *_totals_values(stats.overall)), subtotal=True
    )
    sheet.cell(total_row, rate_column).number_format = "0.0%"


def _trend(workbook: Workbook, stats: CompanyStatsRead, language: WorkbookLanguage) -> None:
    sheet = _sheet(
        workbook,
        "trend",
        (
            "from",
            "to",
            "absence.days",
            "absence.episodes",
            "single_punch",
            "late",
            "late_minutes",
            "sick.days",
            "sick.count",
        ),
        language,
        widths=(15, 15, 16, 16, 16, 15, 22, 16, 20),
    )
    for bucket in stats.series:
        _append(
            sheet,
            (
                bucket.start,
                bucket.end,
                bucket.absence_days,
                bucket.absence_episodes,
                bucket.single_punch,
                bucket.late_count,
                bucket.late_minutes,
                bucket.sick_days,
                bucket.sick_count,
            ),
        )


def _ranking(workbook: Workbook, stats: CompanyStatsRead, language: WorkbookLanguage) -> None:
    columns = (
        "employee_id",
        "employee",
        "position",
        "company",
        "shift",
        "absence.days",
        "absence.episodes",
        "single_punch",
        "late",
        "late_minutes",
        "sick_days",
        "leave.days",
        "leave.count",
        "events",
        "score",
        "tier",
        "transfer_from",
        "transfer_to",
        "transfer_on",
    )
    sheet = _sheet(
        workbook,
        "ranking",
        columns,
        language,
        widths=(16, 32, 24, 22, 16, 16, 16, 16, 12, 20, 16, 16, 18, 16, 12, 22, 22, 22, 17),
        freeze="C2",
    )
    for row in stats.ranking.rows:
        if row.small_sample:
            label = _label("small", language)
        elif row.tier is not None:
            label = _label("bad" if row.tier == "needs_intervention" else "warn", language)
        else:
            label = None
        transfer = row.transfer
        _append(
            sheet,
            (
                row.employee_id,
                _preferred(row.name_en, row.name_ar, language),
                _preferred(row.position, row.position_ar, language),
                _unit_label(row.duty_unit, language),
                _shift_label(row.shift_code, language),
                row.absence_days,
                row.absence_episodes,
                row.single_punch,
                row.late_count,
                row.late_minutes,
                row.sick_days,
                row.leave_days,
                row.leave_count,
                row.events,
                row.score,
                label,
                transfer.from_unit if transfer else None,
                transfer.to_unit if transfer else None,
                transfer.on_date if transfer else None,
            ),
        )


def _national_service(
    workbook: Workbook, stats: CompanyStatsRead, language: WorkbookLanguage
) -> None:
    sheet = _sheet(
        workbook,
        "national_service",
        (
            "employee_id",
            "employee",
            "company",
            "from",
            "to",
            "return",
            "remaining",
            "progress",
        ),
        language,
        widths=(20, 32, 24, 16, 16, 18, 18, 20),
        freeze="C2",
    )
    for employee in stats.national_service.enrolled:
        row = _append(
            sheet,
            (
                employee.employee_id,
                _preferred(employee.name_en, employee.name_ar, language),
                _unit_label(employee.duty_unit, language),
                employee.start_date,
                employee.end_date,
                employee.return_date,
                employee.days_remaining,
                employee.progress,
            ),
        )
        sheet.cell(row, 8).number_format = "0.0%"
    row = _append(
        sheet,
        (_label("service_days", language), None, None, None, stats.national_service.absence_days),
        subtotal=True,
    )
    sheet.merge_cells(start_row=row, end_row=row, start_column=1, end_column=4)


def build_company_stats_workbook(stats: CompanyStatsRead, *, language: WorkbookLanguage) -> bytes:
    """Render the report, including the full score-ranked roster, without any I/O."""
    workbook = Workbook()
    workbook.remove(workbook.active)
    _summary(workbook, stats, language)
    _companies(workbook, stats, language)
    _trend(workbook, stats, language)
    _ranking(workbook, stats, language)
    _national_service(workbook, stats, language)
    with BytesIO() as buffer:
        workbook.save(buffer)
        return buffer.getvalue()


def company_stats_filename(
    from_date: date, to_date: date, duty_unit: str | None, language: WorkbookLanguage
) -> str:
    unit = _INVALID_FILENAME.sub("-", _scope_label(duty_unit, language)).strip(" .")[:80]
    title = _label("title", language)
    name = f"{title} - {unit}" if unit else title
    return f"{name} - {from_date.isoformat()} - {to_date.isoformat()}.xlsx"

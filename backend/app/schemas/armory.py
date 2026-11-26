"""Armory request and response contracts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.schemas._base import ORMBase

MAX_QTY = 2_147_483_647

ArmoryKind = Literal["firearm", "ammunition", "serial", "quantity", "expiry"]
ArmoryCategory = Literal[
    "firearms", "ammo", "accessories", "nonlethal", "restraints", "riot", "comms"
]
ArmoryDrawing = Literal[
    "rifle",
    "pistol",
    "magazine",
    "rounds",
    "sling",
    "holster",
    "tool",
    "rod",
    "scabbard",
    "grip",
    "adapter",
    "case",
    "taser",
    "spray",
    "cartridge",
    "cuffs",
    "leg-irons",
    "plastic",
    "key",
    "baton",
    "helmet",
    "shield",
    "riot-suit",
    "radio",
    "bodycam",
    "wand",
]
ArmorySerialState = Literal[
    "in_safe", "signed_out", "in_custody", "in_repair", "missing", "lost", "written_off"
]
ArmorySerialAction = Literal["send_repair", "return_repair", "mark_lost", "write_off", "transfer"]
ArmoryPostingKind = Literal[
    "opening",
    "receipt",
    "serial_registration",
    "shift_issue",
    "custody",
    "return",
    "shift_check",
    "monthly_count",
    "serial_state",
    "decision",
]
ArmoryIntakeSource = Literal["supplier", "head_office", "other"]
ArmoryKitCode = Literal["rifle", "pistol", "equipment"]
ArmoryLicenceStatus = Literal["missing", "expired", "expiring", "valid"]
ArmoryBatchStatus = Literal["expired", "expiring", "valid"]
ArmoryDiscrepancyKind = Literal[
    "rounds_shortfall", "missing_serial", "unexpected_serial", "monthly_quantity"
]
ArmoryDecisionOutcome = Literal["found", "used_in_training", "lost", "recording_error"]
OffDutyReason = Literal["cover", "escort", "training", "other"]
ShortfallReason = Literal["training", "incident", "lost", "other"]
ReturnCondition = Literal["ok", "repair"]
HolderKind = Literal["person", "site"]
AssignmentKind = Literal["shift", "custody"]
AssignmentState = Literal["active", "ended", "voided"]
ShiftKind = Literal["day", "night"]
CheckSlotStatus = Literal["due", "missed", "completed"]
DiscrepancyStatus = Literal["open", "resolved", "voided"]
KitLineRole = Literal["default", "alternative", "optional"]
PeoplePurpose = Literal["issue", "custody", "witness", "qualification"]
StockView = Literal["all", "needs_attention"]
CustodyStateFilter = Literal["active", "ended", "all"]
DiscrepancyStatusFilter = Literal["open", "resolved", "all"]
CountKindFilter = Literal["shift_check", "monthly_count"]

_Id = Annotated[int, Field(strict=True, ge=1)]
_Quantity = Annotated[int, Field(strict=True, ge=0, le=MAX_QTY)]
_GraceMinutes = Annotated[int, Field(strict=True, ge=0, le=1440)]
_Name = Annotated[str, Field(min_length=1, max_length=120)]
_EmployeeId = Annotated[str, Field(min_length=1, max_length=16)]
_Code = Annotated[str, Field(min_length=1, max_length=80)]
_Reference = Annotated[str, Field(max_length=80)]
_Note = Annotated[str, Field(max_length=500)]
_Time = Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]
_Month = Annotated[str, Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")]
_ExpiryDate = Annotated[
    str, Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?$")
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ArmorySafeCreate(Input):
    name_en: _Name
    name_ar: _Name
    vehicle_site_id: _Id | None = None
    duty_unit: _Name | None = None
    duty_post: _Name | None = None


class ArmorySettingsUpdate(Input):
    day_start: _Time
    night_start: _Time
    grace_minutes: _GraceMinutes


class ArmoryQuantityIntake(Input):
    type: Literal["quantity"]
    qty: _Quantity


class ArmorySerialIntake(Input):
    type: Literal["serial"]
    serial_codes: list[_Code]
    unrecorded_qty: _Quantity | None = None


class ArmoryBatchIntake(Input):
    batch_ref: _Code
    expires_on: _ExpiryDate
    qty: _Quantity


class ArmoryExpiryIntake(Input):
    type: Literal["expiry"]
    batches: list[ArmoryBatchIntake]
    counted_zero: bool = False


ArmoryIntakeEntry = Annotated[
    ArmoryQuantityIntake | ArmorySerialIntake | ArmoryExpiryIntake, Field(discriminator="type")
]


class ArmoryOpeningInput(Input):
    safe_id: _Id
    received_on: date
    reference: _Reference | None = None
    witness_employee_id: _EmployeeId | None = None
    entry: ArmoryIntakeEntry


class ArmoryItemCreate(Input):
    name_en: _Name
    name_ar: _Name
    kind: ArmoryKind
    category: ArmoryCategory
    drawing: ArmoryDrawing
    optional_kit_ids: list[_Id] = Field(default_factory=list)
    openings: list[ArmoryOpeningInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_kits_and_openings(self) -> Self:
        if len(set(self.optional_kit_ids)) != len(self.optional_kit_ids):
            raise ValueError("optional_kit_ids must not contain duplicates")
        if len({opening.safe_id for opening in self.openings}) != len(self.openings):
            raise ValueError("openings must not repeat a safe_id")
        return self


class ArmoryIntakeLineInput(Input):
    item_id: _Id
    entry: ArmoryIntakeEntry


class ArmoryReceiptCreate(Input):
    safe_id: _Id
    kind: Literal["opening", "receipt"]
    received_on: date
    source: ArmoryIntakeSource | None = None
    reference: _Reference | None = None
    witness_employee_id: _EmployeeId | None = None
    lines: list[ArmoryIntakeLineInput] = Field(min_length=1)

    @model_validator(mode="after")
    def _source_only_for_receipts(self) -> Self:
        if self.source is not None and self.kind != "receipt":
            raise ValueError("source is only allowed for receipts")
        return self


class ArmorySerialRegistrationCreate(Input):
    safe_id: _Id
    serial_codes: list[_Code] = Field(min_length=1)
    reference: _Reference | None = None
    witness_employee_id: _EmployeeId | None = None


class ArmorySerialMovementCreate(Input):
    action: ArmorySerialAction
    expected_state: ArmorySerialState
    expected_safe_id: _Id
    expected_posting_id: _Id
    destination_safe_id: _Id | None = None
    reason: str = Field(min_length=3, max_length=500)
    witness_employee_id: _EmployeeId

    @model_validator(mode="after")
    def _destination_only_for_transfer(self) -> Self:
        if (self.action == "transfer") != (self.destination_safe_id is not None):
            raise ValueError(
                "destination_safe_id is required for transfers and not allowed otherwise"
            )
        return self


class ArmoryAssignmentLineInput(Input):
    item_id: _Id
    qty: _Quantity
    serial_id: _Id | None = None
    batch_id: _Id | None = None


class ArmoryShiftIssueCreate(Input):
    safe_id: _Id
    employee_id: _EmployeeId
    kit_id: _Id
    lines: list[ArmoryAssignmentLineInput] = Field(min_length=1)
    due_at: AwareDatetime | None = None
    off_duty_reason: OffDutyReason | None = None
    off_duty_note: _Note | None = None
    excess_rounds_reason: _Note | None = None
    licence_warning_acknowledged: bool = False


class ArmoryCustodyCreate(Input):
    safe_id: _Id
    holder_kind: HolderKind
    holder_employee_id: _EmployeeId | None = None
    holder_safe_id: _Id | None = None
    supervisor_employee_id: _EmployeeId | None = None
    kit_id: _Id
    lines: list[ArmoryAssignmentLineInput] = Field(min_length=1)
    condition_note: _Note | None = None
    excess_rounds_reason: _Note | None = None
    licence_warning_acknowledged: bool = False


class ArmoryShortfallInput(Input):
    reason: ShortfallReason
    reference: str = Field(min_length=3, max_length=80)
    note: _Note | None = None


class ArmoryReturnLineInput(Input):
    assignment_line_id: _Id
    expected_remaining_qty: _Quantity
    returned_qty: _Quantity
    condition: ReturnCondition | None = None
    fault_note: _Note | None = None
    shortfall: ArmoryShortfallInput | None = None


class ArmoryReturnCreate(Input):
    assignment_id: _Id
    witness_employee_id: _EmployeeId | None = None
    lines: list[ArmoryReturnLineInput] = Field(min_length=1)


class ArmoryBulkReturnCreate(Input):
    safe_id: _Id
    records: list[ArmoryReturnCreate] = Field(min_length=1)


class ArmoryQualificationUpsert(Input):
    course_round: Annotated[int, Field(strict=True, ge=1)] | None
    licence_number: _Code | None
    licence_expires_on: date | None


class ArmoryShiftCheckCreate(Input):
    snapshot_token: str
    observed_serial_ids: list[_Id]
    confirm_missing: bool
    witness_employee_id: _EmployeeId

    @model_validator(mode="after")
    def _unique_observed_serials(self) -> Self:
        if len(set(self.observed_serial_ids)) != len(self.observed_serial_ids):
            raise ValueError("observed_serial_ids must not contain duplicates")
        return self


class ArmoryCountObservation(Input):
    item_id: _Id
    observed_qty: _Quantity
    observed_serial_codes: list[_Code] = Field(default_factory=list)
    serials_complete: bool = False


class ArmoryMonthlyCountCreate(Input):
    snapshot_token: str
    witness_employee_id: _EmployeeId
    lines: list[ArmoryCountObservation] = Field(min_length=1)


class ArmoryDecisionBatchInput(Input):
    batch_id: _Id
    qty: _Quantity


class ArmoryDecisionCreate(Input):
    outcome: ArmoryDecisionOutcome
    note: str = Field(min_length=1, max_length=500)
    witness_employee_id: _EmployeeId
    batches: list[ArmoryDecisionBatchInput] = Field(default_factory=list, min_length=1)


class ArmoryVoid(Input):
    reason: str = Field(min_length=1, max_length=500)
    witness_employee_id: _EmployeeId | None = None


class ArmoryNameRead(ORMBase):
    name_en: str
    name_ar: str | None


class ArmorySiteRead(ORMBase):
    id: int
    name_en: str
    name_ar: str


class ArmoryDutyPostRead(ORMBase):
    duty_unit: str
    duty_post: str


class ArmorySafeRead(ORMBase):
    id: int
    name_en: str
    name_ar: str
    vehicle_site: ArmorySiteRead | None
    duty_post: ArmoryDutyPostRead | None
    created_at: datetime


class ArmorySiteOptionsRead(ORMBase):
    vehicle_sites: list[ArmorySiteRead]
    duty_posts: list[ArmoryDutyPostRead]


class ArmoryShiftPolicyRead(ORMBase):
    day_start: _Time
    night_start: _Time
    grace_minutes: int
    effective_on: date | None


class ArmorySettingsRead(ORMBase):
    version: int
    current: ArmoryShiftPolicyRead
    pending: ArmoryShiftPolicyRead | None


class ArmoryShiftWindowRead(ORMBase):
    time_zone: str
    shift_date: date
    shift_kind: ShiftKind
    starts_at: datetime
    ends_at: datetime
    next_ends_at: datetime
    grace_minutes: int


class ArmoryPersonRead(ORMBase):
    employee_id: str
    name_en: str
    name_ar: str | None
    employee_status: str
    is_former: bool


class ArmoryActorRead(ORMBase):
    user_id: int
    employee: ArmoryPersonRead | None
    display_name: str | None


class ArmoryItemRef(ORMBase):
    id: int
    name_en: str
    name_ar: str
    kind: ArmoryKind
    category: ArmoryCategory
    drawing: ArmoryDrawing


class ArmoryBatchRef(ORMBase):
    id: int
    batch_ref: str
    expires_on: date


class ArmoryBatchRead(ORMBase):
    batch: ArmoryBatchRef
    safe: ArmorySafeRead
    on_hand: int
    status: ArmoryBatchStatus


class ArmoryStockTotals(ORMBase):
    opening_qty: int | None
    received_qty: int
    known_in_safe: int
    in_safe: int | None
    available_qty: int
    unrecorded_qty: int | None
    out_on_shift: int
    in_custody: int
    in_repair: int | None
    missing: int | None
    lost: int | None
    written_off: int | None
    awaiting_rounds_decision: int | None
    expended_rounds: int | None
    lost_rounds: int | None
    settled_rounds: int | None
    expired_qty: int | None
    book_total: int | None


class ArmoryStockRead(ArmoryStockTotals):
    safe: ArmorySafeRead


class ArmoryItemRead(ArmoryItemRef):
    preset_key: str | None
    optional_kit_ids: list[int]
    stock: list[ArmoryStockRead]
    totals: ArmoryStockTotals


class ArmoryKitLineRead(ORMBase):
    item: ArmoryItemRef
    role: KitLineRole
    default_qty: int
    substitutes_item_id: int | None


class ArmoryKitRead(ORMBase):
    id: int
    code: ArmoryKitCode
    name_en: str
    name_ar: str
    firearm_item: ArmoryItemRef | None
    lines: list[ArmoryKitLineRead]


class ArmoryHolderRead(ORMBase):
    kind: HolderKind
    employee: ArmoryPersonRead | None
    site_safe: ArmorySafeRead | None
    supervisor: ArmoryPersonRead | None


class ArmorySerialRead(ORMBase):
    id: int
    item: ArmoryItemRef
    serial_code: str
    safe: ArmorySafeRead | None
    state: ArmorySerialState | None
    state_at: datetime | None
    last_posting_id: int
    assignment_id: int | None
    holder: ArmoryHolderRead | None
    overdue_minutes: int | None


class ArmoryPostingRef(ORMBase):
    id: int
    record_ref: str
    kind: ArmoryPostingKind
    safe_id: int
    occurred_on: date
    occurred_at: datetime | None
    voided_at: datetime | None


class ArmoryItemDetailRead(ArmoryItemRead):
    serials: list[ArmorySerialRead]
    batches: list[ArmoryBatchRead]
    recent_movements: list[ArmoryPostingRef]


class ArmorySerialDetailRead(ArmorySerialRead):
    recent_movements: list[ArmoryPostingRef]


class ArmoryAssignmentLineRead(ORMBase):
    id: int
    item: ArmoryItemRef
    qty: int
    remaining_qty: int
    serial_id: int | None
    serial_code: str | None
    batch: ArmoryBatchRef | None


class ArmoryAssignmentSummary(ORMBase):
    id: int
    record_ref: str
    kind: AssignmentKind
    state: AssignmentState
    safe: ArmorySafeRead
    holder: ArmoryHolderRead
    issuer: ArmoryActorRead
    issued_at: datetime
    due_at: datetime | None
    overdue_minutes: int | None
    licence_warning_acknowledged: bool
    changed_kit: bool
    lines: list[ArmoryAssignmentLineRead]


class ArmoryCustodyReceiptLineRead(ORMBase):
    item: ArmoryItemRef
    qty: int
    serial_code: str | None


class ArmoryCustodyReceiptRead(ORMBase):
    record_ref: str
    issued_at: datetime
    source_safe: ArmoryNameRead
    holder: ArmoryNameRead
    holder_employee_id: str | None
    supervisor: ArmoryNameRead | None
    supervisor_employee_id: str | None
    armorer: ArmoryNameRead
    firearm_included: bool
    licence_number: str | None
    condition_note: str | None
    lines: list[ArmoryCustodyReceiptLineRead]


class ArmoryAssignmentRead(ArmoryAssignmentSummary):
    kit_id: int
    course_round_snapshot: int | None
    licence_status_at_issue: ArmoryLicenceStatus | None
    shift_window: ArmoryShiftWindowRead | None
    grace_minutes: int | None
    off_duty_reason: OffDutyReason | None
    off_duty_note: str | None
    excess_rounds_reason: str | None
    condition_note: str | None
    ended_at: datetime | None
    ended_by: ArmoryActorRead | None
    return_ids: list[int]
    voided_at: datetime | None
    voided_by: ArmoryActorRead | None
    void_reason: str | None
    receipt: ArmoryCustodyReceiptRead | None


class ArmoryQualificationRead(ORMBase):
    version: int
    course_round: int | None
    licence_number: str | None
    licence_expires_on: date | None
    licence_status: ArmoryLicenceStatus
    licence_days_left: int | None
    updated_at: datetime | None


class ArmoryOpenFirearmRead(ORMBase):
    assignment_id: int
    assignment_kind: AssignmentKind
    item: ArmoryItemRef
    serial_id: int
    serial_code: str


class ArmoryPersonCandidateRead(ORMBase):
    person: ArmoryPersonRead
    on_duty_here: bool
    course_round: int | None
    licence_status: ArmoryLicenceStatus
    licence_expires_on: date | None
    open_firearm: ArmoryOpenFirearmRead | None


class ArmoryGuardRead(ORMBase):
    person: ArmoryPersonRead
    qualification: ArmoryQualificationRead
    open_assignments: list[ArmoryAssignmentSummary]


class ArmoryLicenceCounts(ORMBase):
    missing: int
    expired: int
    expiring: int
    valid: int


class ArmoryGuardPage(ORMBase):
    items: list[ArmoryGuardRead]
    page: int
    page_size: int
    total: int
    filter_counts: ArmoryLicenceCounts


class ArmoryAssignmentPage(ORMBase):
    items: list[ArmoryAssignmentSummary]
    page: int
    page_size: int
    total: int


class ArmoryMovementLineRead(ORMBase):
    id: int
    item: ArmoryItemRef
    qty: int
    serial_id: int | None
    serial_code: str | None
    batch: ArmoryBatchRef | None
    stock_delta: int
    before_on_hand: int | None
    after_on_hand: int | None
    before_state: ArmorySerialState | None
    after_state: ArmorySerialState | None
    before_safe_id: int | None
    after_safe_id: int | None
    assignment_line_id: int | None
    remaining_before: int | None
    remaining_after: int | None
    condition: ReturnCondition | None
    fault_note: str | None


class ArmoryPostingRead(ArmoryPostingRef):
    safe: ArmorySafeRead
    destination_safe: ArmorySafeRead | None
    related_posting_id: int | None
    created_at: datetime
    actor: ArmoryActorRead
    witness: ArmoryPersonRead | None
    person: ArmoryPersonRead | None
    reference: str | None
    source: ArmoryIntakeSource | None
    reason: str | None
    note: str | None
    serial_action: ArmorySerialAction | None
    decision_outcome: ArmoryDecisionOutcome | None
    voided_by: ArmoryActorRead | None
    void_reason: str | None
    void_witness: ArmoryPersonRead | None
    lines: list[ArmoryMovementLineRead]
    discrepancy_ids: list[int]


class ArmoryPostingPage(ORMBase):
    items: list[ArmoryPostingRead]
    page: int
    page_size: int
    total: int


class ArmoryReturnRead(ORMBase):
    posting: ArmoryPostingRead
    assignment: ArmoryAssignmentSummary


class ArmoryCheckSlotRead(ORMBase):
    window: ArmoryShiftWindowRead
    status: CheckSlotStatus
    count_id: int | None
    missing_count: int | None


class ArmoryShiftSafeRead(ORMBase):
    safe: ArmorySafeRead
    firearms: list[ArmorySerialRead]
    out: list[ArmoryAssignmentSummary]
    returned_today: list[ArmoryReturnRead]
    on_duty: list[ArmoryPersonCandidateRead]
    check_history: list[ArmoryCheckSlotRead]


class ArmoryAlertsRead(ORMBase):
    now_at: datetime
    missing_firearm_count: int
    missing_firearms: list[ArmorySerialRead]
    overdue_count: int
    overdue: list[ArmoryAssignmentSummary]
    decision_count: int
    due_check_count: int
    expired_batch_count: int
    expiring_batch_count: int
    licences: ArmoryLicenceCounts
    former_open_count: int


class ArmoryShiftRead(ORMBase):
    window: ArmoryShiftWindowRead
    safes: list[ArmoryShiftSafeRead]
    attention: ArmoryAlertsRead


class ArmoryCheckReconciliation(ORMBase):
    signed_out: list[ArmorySerialRead]
    in_custody: list[ArmorySerialRead]
    in_repair: list[ArmorySerialRead]
    missing: list[ArmorySerialRead]
    lost: list[ArmorySerialRead]
    assigned_count: int


class ArmoryShiftCheckDraftRead(ORMBase):
    safe: ArmorySafeRead
    window: ArmoryShiftWindowRead
    snapshot_token: str
    expected: list[ArmorySerialRead]
    reconciliation: ArmoryCheckReconciliation


class ArmoryMonthlyCountDraftRead(ORMBase):
    safe: ArmorySafeRead
    month: _Month
    snapshot_token: str
    items: list[ArmoryItemRef]


class ArmoryCountSerialRef(ORMBase):
    serial_id: int
    serial_code: str


class ArmoryCountLineRead(ORMBase):
    item: ArmoryItemRef
    expected_qty: int | None
    observed_qty: int
    expected_serials: list[ArmoryCountSerialRef]
    observed_serial_codes: list[str]
    expected_unrecorded_qty: int | None
    observed_unrecorded_qty: int | None


class ArmoryCountRead(ORMBase):
    posting: ArmoryPostingRef
    safe: ArmorySafeRead
    actor: ArmoryActorRead
    witness: ArmoryPersonRead
    window: ArmoryShiftWindowRead | None
    month: _Month | None
    reconciliation: ArmoryCheckReconciliation | None
    lines: list[ArmoryCountLineRead]
    discrepancy_ids: list[int]


class ArmoryCountPage(ORMBase):
    items: list[ArmoryCountRead]
    page: int
    page_size: int
    total: int


class ArmoryDecisionRead(ORMBase):
    posting: ArmoryPostingRead
    outcome: ArmoryDecisionOutcome


class ArmoryDiscrepancyRead(ORMBase):
    id: int
    kind: ArmoryDiscrepancyKind
    status: DiscrepancyStatus
    source: ArmoryPostingRef
    safe: ArmorySafeRead
    item: ArmoryItemRef
    serial_id: int | None
    serial_code: str | None
    assignment_line_id: int | None
    person: ArmoryPersonRead | None
    expected_qty: int
    observed_qty: int
    recorder: ArmoryActorRead
    source_witness: ArmoryPersonRead | None
    shortfall_reason: ShortfallReason | None
    reference: str | None
    note: str | None
    allowed_outcomes: list[ArmoryDecisionOutcome]
    can_decide: bool
    decision: ArmoryDecisionRead | None


class ArmoryDiscrepancyPage(ORMBase):
    items: list[ArmoryDiscrepancyRead]
    page: int
    page_size: int
    total: int


class ArmoryFindRead(ORMBase):
    serials: list[ArmorySerialRead]
    guards: list[ArmoryPersonRead]
    items: list[ArmoryItemRef]
    custody: list[ArmoryAssignmentSummary]
    postings: list[ArmoryPostingRef]


class ArmoryEmployeeRead(ORMBase):
    person: ArmoryPersonRead
    qualification: ArmoryQualificationRead
    open_assignments: list[ArmoryAssignmentSummary]
    history: ArmoryAssignmentPage


class ArmoryClearanceLineRead(ORMBase):
    item: ArmoryNameRead
    serial_code: str | None
    remaining_qty: int


class ArmoryClearanceRecordRead(ORMBase):
    id: int
    record_ref: str
    kind: AssignmentKind
    safe: ArmoryNameRead
    issued_at: datetime
    due_at: datetime | None
    lines: list[ArmoryClearanceLineRead]


class ArmoryClearanceRead(ORMBase):
    employee_id: str
    records: list[ArmoryClearanceRecordRead]

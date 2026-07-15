"""Returnability rules: only Annual Leave and National Service require a Duty
Resumption (return) form. All other request-group kinds — Compassionate, Duty,
Emergency, Hajj, and legacy 'Others' — are NOT returnable: once Approved they are
terminal (no AwaitingReturn, no return action, no needs-action nudge)."""

from app.core import leave_lifecycle as ll

_RETURNABLE = ["Annual Leave", "National Service"]
_NOT_RETURNABLE_REQUEST = [
    "Compassionate Leave",
    "Duty Leave",
    "Emergency Leave",
    "Hajj Leave",
    "Maternity Leave",  # legacy -> Others
    "Unpaid Leave",  # legacy -> Others
]
_NON_REQUEST = ["Sick Leave", "Administrative Leave", "Leave Permit"]


class TestIsReturnable:
    def test_annual_and_national_service_are_returnable(self):
        for lt in _RETURNABLE:
            assert ll.is_returnable(lt) is True, lt

    def test_annual_short_form_is_returnable(self):
        # v3 rows sometimes stored the bare word "Annual".
        assert ll.is_returnable("Annual") is True

    def test_bilingual_annual_is_returnable(self):
        assert ll.is_returnable("Annual Leave - إجازة سنوية") is True

    def test_other_request_kinds_are_not_returnable(self):
        for lt in _NOT_RETURNABLE_REQUEST:
            assert ll.is_returnable(lt) is False, lt

    def test_sick_and_record_kinds_are_not_returnable(self):
        for lt in _NON_REQUEST:
            assert ll.is_returnable(lt) is False, lt


class TestCanFileReturn:
    def test_annual_approved_can_file(self):
        assert ll.can_file_return("Annual Leave", "Approved", has_certificate=False) is True

    def test_annual_pending_cannot_file(self):
        assert ll.can_file_return("Annual Leave", "Pending", has_certificate=False) is False

    def test_national_service_pending_with_cert_can_file(self):
        assert ll.can_file_return("National Service", "Pending", has_certificate=True) is True

    def test_national_service_without_cert_cannot_file(self):
        assert ll.can_file_return("National Service", "Pending", has_certificate=False) is False

    def test_non_returnable_request_cannot_file_even_when_approved(self):
        for lt in _NOT_RETURNABLE_REQUEST:
            assert ll.can_file_return(lt, "Approved", has_certificate=False) is False, lt


class TestNeedsAction:
    OVERDUE = "2026-06-01"
    TODAY = "2026-07-01"

    def test_pending_request_still_needs_approval(self):
        # Approval workflow is unchanged for non-returnable kinds.
        for lt in _NOT_RETURNABLE_REQUEST:
            assert ll.needs_action(lt, "Pending", self.OVERDUE, self.TODAY) is True, lt

    def test_annual_approved_overdue_needs_return(self):
        assert ll.needs_action("Annual Leave", "Approved", self.OVERDUE, self.TODAY) is True

    def test_non_returnable_request_approved_overdue_is_terminal(self):
        for lt in _NOT_RETURNABLE_REQUEST:
            assert ll.needs_action(lt, "Approved", self.OVERDUE, self.TODAY) is False, lt


class TestEndingSoon:
    def test_non_returnable_request_never_ends_soon(self):
        # ending_soon is gated on returnability, so these get no heads-up nudge.
        assert ll.ending_soon("Emergency Leave", "Approved", "2026-07-02", "2026-07-01") is False

    def test_annual_ends_soon(self):
        assert ll.ending_soon("Annual Leave", "Approved", "2026-07-02", "2026-07-01") is True


def test_can_amend_annual_approved_only():
    assert ll.can_amend("Annual Leave", "Approved") is True
    # bilingual label + legacy 'Generated' alias both amendable
    assert ll.can_amend("Annual Leave - إجازة سنوية", "Generated") is True
    assert ll.can_amend("Annual Leave", "Pending") is False
    assert ll.can_amend("Annual Leave", "Cancelled") is False
    assert ll.can_amend("Sick Leave", "Approved") is False
    assert ll.can_amend("National Service", "Approved") is False
    assert ll.can_amend("Emergency Leave", "Approved") is False

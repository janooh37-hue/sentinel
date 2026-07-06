"""Ranked employee candidates for the Scan Inbox chips."""

from app.services.extraction_service import match_employee, match_employee_candidates


class E:
    def __init__(self, id_, en, ar=None):
        self.id = id_
        self.name_en = en
        self.name_ar = ar
        self.uae_id_no = None
        self.passport_no = None


def test_candidates_ranked_capped_and_floored():
    emps = [E("G1", "Ahmed Ali"), E("G2", "Ali Hassan"), E("G3", "Ahmad Aly"), E("G4", "Zzz Xxx")]
    cands = match_employee_candidates({"name_en": "Ahmed Ali"}, emps, limit=3, floor=55.0)
    assert cands, "expected at least one candidate"
    assert cands[0]["employee_id"] == "G1"
    assert len(cands) <= 3
    assert all(c["score"] >= 0.55 for c in cands)
    assert all(set(c) == {"employee_id", "name_en", "name_ar", "score"} for c in cands)
    # G4 is far below the floor and must be excluded
    assert "G4" not in [c["employee_id"] for c in cands]


def test_candidates_empty_without_a_name_field():
    assert match_employee_candidates({}, [E("G1", "Ahmed Ali")]) == []


def test_match_employee_top_equals_candidate_top():
    emps = [E("G1", "Ahmed Ali"), E("G2", "Ali Hassan")]
    emp, _score = match_employee({"name_en": "Ahmed Ali"}, emps)
    top = match_employee_candidates({"name_en": "Ahmed Ali"}, emps)[0]
    assert emp is not None and emp.id == top["employee_id"]

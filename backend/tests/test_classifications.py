from app.core.classifications import CLASSIFICATIONS, classified_ref, get_classification
from app.db.repos.classified_refs_repo import allocate_classified_serial


def test_registry_has_all_15_codes():
    codes = [c.code for c in CLASSIFICATIONS]
    assert len(codes) == 15 and len(set(codes)) == 15
    assert "5/1" in codes and "15/1" in codes
    c = get_classification("5/1")
    assert c is not None and c.tab == 5 and c.name_ar == "التصاريح الأمنية"


def test_classified_ref_format():
    assert classified_ref(5, 141) == "1/5/141"


def test_serial_is_shared_and_monotonic(db_session):
    a = allocate_classified_serial(db_session)
    db_session.commit()
    b = allocate_classified_serial(db_session)
    db_session.commit()
    assert b == a + 1

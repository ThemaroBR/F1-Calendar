from backend.storage import _normalize_session_name


def test_normalize_session_name():
    assert _normalize_session_name("Practice 1") == "FP1"
    assert _normalize_session_name("Qualifying") == "Qualifying"
    assert _normalize_session_name("Sprint Qualifying") == "Sprint Qualifying"
    assert _normalize_session_name("Race") == "Race"

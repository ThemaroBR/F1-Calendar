from datetime import datetime, timezone

from backend.models import Race
from backend.services import next_race


def test_next_race_returns_closest_upcoming():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    races = [
        Race(
            name="Race A",
            track="Track A",
            country_name=None,
            country_code=None,
            start=datetime(2026, 1, 12, tzinfo=timezone.utc),
            sessions={"Race": datetime(2026, 1, 12, tzinfo=timezone.utc)},
        ),
        Race(
            name="Race B",
            track="Track B",
            country_name=None,
            country_code=None,
            start=datetime(2026, 1, 11, tzinfo=timezone.utc),
            sessions={"Race": datetime(2026, 1, 11, tzinfo=timezone.utc)},
        ),
    ]

    result = next_race(races, now=now)
    assert result is not None
    assert result.name == "Race B"


def test_next_race_returns_none_when_no_upcoming():
    now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    races = [
        Race(
            name="Race A",
            track="Track A",
            country_name=None,
            country_code=None,
            start=datetime(2026, 1, 10, tzinfo=timezone.utc),
            sessions={"Race": datetime(2026, 1, 10, tzinfo=timezone.utc)},
        )
    ]

    assert next_race(races, now=now) is None

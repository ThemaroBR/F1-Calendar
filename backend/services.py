from datetime import datetime, timezone

import pytz
from .models import Race


def to_local(dt: datetime, tzname: str) -> datetime:
    """Convert a UTC datetime to the given time zone.

    The incoming ``dt`` should be timezone-aware in UTC; the return
    value will be localized to ``tzname``.
    """
    return dt.astimezone(pytz.timezone(tzname))


def is_valid_timezone(tzname: str) -> bool:
    """Return True when ``tzname`` is a valid IANA time zone."""
    try:
        pytz.timezone(tzname)
        return True
    except pytz.UnknownTimeZoneError:
        return False


def race_to_timezone(race: Race, tzname: str) -> Race:
    """Return a copy of ``race`` with all datetimes converted to ``tzname``."""
    return Race(
        name=race.name,
        track=race.track,
        country_name=race.country_name,
        country_code=race.country_code,
        start=to_local(race.start, tzname),
        sessions={key: to_local(value, tzname) for key, value in race.sessions.items()},
    )


def next_race(races: list[Race], now: datetime | None = None) -> Race | None:
    """Return the closest upcoming race relative to ``now`` in UTC."""
    now_utc = now or datetime.now(timezone.utc)
    upcoming = [race for race in races if race.start >= now_utc]
    if not upcoming:
        return None
    return min(upcoming, key=lambda race: race.start)

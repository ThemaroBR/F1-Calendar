import json
import logging
import time
from pathlib import Path
from typing import TypedDict
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from .models import Race
from .settings import CACHE_TTL_SECONDS, OPENF1_SESSIONS_URL, TARGET_YEAR


DATA_FILE = Path(__file__).parent.parent / "data" / "races.json"

logger = logging.getLogger(__name__)

_cache: list[Race] | None = None
_cache_until: float = 0.0


class OpenF1SessionRow(TypedDict, total=False):
    meeting_key: int
    session_name: str
    date_start: str
    year: int
    country_name: str
    meeting_name: str
    circuit_short_name: str
    location: str


class MeetingAccumulator(TypedDict):
    name: str
    track: str
    country_name: str | None
    country_code: str | None
    sessions: dict[str, str]


def _normalize_session_name(name: str) -> str:
    """Map OpenF1 session names to the labels used by this project."""
    normalized = name.strip().lower()
    mapping = {
        "practice 1": "FP1",
        "practice 2": "FP2",
        "practice 3": "FP3",
        "qualifying": "Qualifying",
        "sprint": "Sprint",
        "sprint qualifying": "Sprint Qualifying",
        "race": "Race",
    }
    return mapping.get(normalized, name)


def _fetch_openf1_sessions(year: int) -> list[OpenF1SessionRow]:
    params = urlencode({"year": year})
    url = f"{OPENF1_SESSIONS_URL}?{params}"
    with urlopen(url, timeout=10) as response:
        payload = response.read().decode("utf-8")

    data = json.loads(payload)
    if not isinstance(data, list):
        raise ValueError("Unexpected payload from OpenF1 sessions API")
    return [row for row in data if isinstance(row, dict)]


COUNTRY_CODE_MAP = {
    "australia": "AU",
    "bahrain": "BH",
    "saudi arabia": "SA",
    "china": "CN",
    "japan": "JP",
    "united states": "US",
    "united states of america": "US",
    "mexico": "MX",
    "brazil": "BR",
    "monaco": "MC",
    "canada": "CA",
    "united kingdom": "GB",
    "great britain": "GB",
    "england": "GB",
    "spain": "ES",
    "austria": "AT",
    "hungary": "HU",
    "belgium": "BE",
    "netherlands": "NL",
    "italy": "IT",
    "azerbaijan": "AZ",
    "singapore": "SG",
    "qatar": "QA",
    "united arab emirates": "AE",
    "uae": "AE",
    "france": "FR",
}


def _country_code_from_name(country_name: str | None) -> str | None:
    if not country_name:
        return None
    return COUNTRY_CODE_MAP.get(country_name.strip().lower())


def _build_races_from_sessions(rows: list[OpenF1SessionRow]) -> list[Race]:
    meetings: dict[int, MeetingAccumulator] = {}

    for row in rows:
        meeting_key = row.get("meeting_key")
        session_name = row.get("session_name")
        date_start = row.get("date_start")
        if meeting_key is None or not session_name or not date_start:
            continue

        year = row.get("year")
        if year is not None and year != TARGET_YEAR:
            continue

        country_name = row.get("country_name")
        country_code = _country_code_from_name(country_name)
        meeting_name = row.get("meeting_name")
        track = row.get("circuit_short_name") or row.get("location") or "Unknown Track"
        name = (country_name and f"{country_name} Grand Prix") or meeting_name or "Unknown Grand Prix"

        meeting = meetings.setdefault(
            meeting_key,
            {
                "name": name,
                "track": track,
                "country_name": country_name,
                "country_code": country_code,
                "sessions": {},
            },
        )
        if meeting.get("country_name") is None and country_name:
            meeting["country_name"] = country_name
        if meeting.get("country_code") is None and country_code:
            meeting["country_code"] = country_code
        meeting["sessions"][_normalize_session_name(session_name)] = date_start

    races: list[Race] = []
    for meeting in meetings.values():
        sessions = meeting["sessions"]
        if not sessions:
            continue

        race_start = sessions.get("Race") or min(sessions.values())
        races.append(
            Race(
                name=meeting["name"],
                track=meeting["track"],
                country_name=meeting.get("country_name"),
                country_code=meeting.get("country_code"),
                start=race_start,
                sessions=sessions,
            )
        )

    return sorted(races, key=lambda race: race.start)


def _load_local_races() -> list[Race]:
    with DATA_FILE.open() as file:
        data = json.load(file)
    return [race for race in (Race(**row) for row in data) if race.start.year == TARGET_YEAR]


def _set_cache(races: list[Race], now: float) -> list[Race]:
    global _cache, _cache_until
    _cache = races
    _cache_until = now + CACHE_TTL_SECONDS
    return races


def load_races() -> list[Race]:
    """Load 2026 races from OpenF1; fallback to races.json when unavailable."""
    now = time.time()
    if _cache is not None and now < _cache_until:
        return _cache

    try:
        rows = _fetch_openf1_sessions(TARGET_YEAR)
        races = _build_races_from_sessions(rows)
        if races:
            return _set_cache(races, now)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("OpenF1 fetch failed; falling back to local data", exc_info=exc)

    return _set_cache(_load_local_races(), now)

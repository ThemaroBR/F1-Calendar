import logging
import time
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .models import Race
from .services import is_valid_timezone, next_race, race_to_timezone
from .storage import load_races
from .settings import (
    API_TITLE,
    CORS_ALLOW_CREDENTIALS,
    CORS_ALLOW_HEADERS,
    CORS_ALLOW_METHODS,
    CORS_ALLOW_ORIGINS,
    LOG_LEVEL,
    OPENF1_PROXY_TTL_SECONDS,
)

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title=API_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=CORS_ALLOW_METHODS,
    allow_headers=CORS_ALLOW_HEADERS,
)

OPENF1_PROXY_BASE = "https://api.openf1.org/v1"
OPENF1_ALLOWED = {"sessions", "session_result", "drivers", "laps", "meetings"}

# TTL per resource type. Historical race results and driver info never change,
# so we cache them for 24 hours. Session lists change only daily. Laps data for a
# finished session is also immutable; cache it for a long time.
_RESOURCE_TTL: dict[str, float] = {
    "session_result": 24 * 3600,
    "drivers": 24 * 3600,
    "laps": 24 * 3600,
    "meetings": 1 * 3600,
    "sessions": 1 * 3600,
}
_DEFAULT_TTL = float(OPENF1_PROXY_TTL_SECONDS)
_CACHE_MAX_SIZE = 512

# Cache entry: (expires_at, stale_until, payload)
# - expires_at  : serve fresh until this time
# - stale_until : after expires_at, keep serving stale data up to this time
#                 while a refresh is attempted
# - payload     : raw JSON bytes
_CacheEntry = tuple[float, float, bytes]
_openf1_cache: dict[str, _CacheEntry] = {}
_logger = logging.getLogger(__name__)


def _cache_ttl(resource: str) -> float:
    return _RESOURCE_TTL.get(resource, _DEFAULT_TTL)


def _evict_if_needed() -> None:
    """Drop the oldest quarter of entries when the cache exceeds its max size."""
    if len(_openf1_cache) < _CACHE_MAX_SIZE:
        return
    sorted_keys = sorted(_openf1_cache, key=lambda key: _openf1_cache[key][0])
    for key in sorted_keys[: _CACHE_MAX_SIZE // 4]:
        _openf1_cache.pop(key, None)


def _store(url: str, resource: str, payload: bytes, now: float) -> None:
    ttl = _cache_ttl(resource)
    # Allow serving stale data for up to 10x the TTL while refreshing
    stale_window = ttl * 10
    _evict_if_needed()
    _openf1_cache[url] = (now + ttl, now + ttl + stale_window, payload)


def _fetch_openf1(url: str) -> bytes:
    with urlopen(url, timeout=15) as response:
        return response.read()


def _parse_timezone(tz: str | None) -> str | None:
    """Validate timezone query parameter and return normalized value."""
    if tz is None:
        return None
    if not is_valid_timezone(tz):
        raise HTTPException(status_code=400, detail="Invalid time zone")
    return tz


def _apply_timezone_to_race(race: Race, tz: str | None) -> Race:
    if tz is None:
        return race
    return race_to_timezone(race, tz)


@app.get("/")
def home():
    return {"message": "F1 calendar API running"}


@app.get("/races", response_model=list[Race])
def list_races(tz: Annotated[str | None, Query()] = None):
    tz = _parse_timezone(tz)
    races = load_races()
    if tz is None:
        return races
    return [race_to_timezone(race, tz) for race in races]


@app.get("/races/next", response_model=Race)
def get_next_race(tz: Annotated[str | None, Query()] = None):
    tz = _parse_timezone(tz)

    race = next_race(load_races())
    if race is None:
        raise HTTPException(status_code=404, detail="No upcoming races found")

    return _apply_timezone_to_race(race, tz)


@app.get("/races/{race_name}", response_model=Race)
def get_race(race_name: str, tz: Annotated[str | None, Query()] = None):
    tz = _parse_timezone(tz)
    race = next((r for r in load_races() if r.name == race_name), None)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    return _apply_timezone_to_race(race, tz)


@app.get("/openf1/{resource}")
def openf1_proxy(resource: str, request: Request):
    if resource not in OPENF1_ALLOWED:
        raise HTTPException(status_code=404, detail="Resource not supported")

    query = request.url.query
    url = f"{OPENF1_PROXY_BASE}/{resource}"
    if query:
        url = f"{url}?{query}"

    now = time.time()
    entry = _openf1_cache.get(url)

    # Fresh: serve directly from cache
    if entry and now < entry[0]:
        return Response(content=entry[2], media_type="application/json", headers={"X-Cache": "HIT"})

    # Stale but within stale window: try refresh; fall back to stale on failure
    if entry and now < entry[1]:
        try:
            payload = _fetch_openf1(url)
            _store(url, resource, payload, now)
            return Response(content=payload, media_type="application/json", headers={"X-Cache": "REFRESHED"})
        except HTTPError as exc:
            if exc.code == 429:
                expires, stale_until, payload = entry
                _openf1_cache[url] = (now + _cache_ttl(resource), stale_until, payload)
                _logger.warning("OpenF1 rate-limited (429); serving stale cache for %s", url)
                return Response(content=payload, media_type="application/json", headers={"X-Cache": "STALE-429"})
            _logger.warning("OpenF1 proxy refresh failed (%s); serving stale", exc.code, exc_info=exc)
            return Response(content=entry[2], media_type="application/json", headers={"X-Cache": "STALE-ERR"})
        except URLError as exc:
            _logger.warning("OpenF1 proxy refresh failed (network); serving stale", exc_info=exc)
            return Response(content=entry[2], media_type="application/json", headers={"X-Cache": "STALE-ERR"})

    # No cache: fetch live
    try:
        payload = _fetch_openf1(url)
        _store(url, resource, payload, now)
        return Response(content=payload, media_type="application/json", headers={"X-Cache": "MISS"})
    except HTTPError as exc:
        if exc.code == 429:
            _logger.warning("OpenF1 rate-limited (429) with no cache for %s", url)
            raise HTTPException(status_code=429, detail="Rate limit reached; please retry shortly")
        _logger.warning("OpenF1 proxy failed (%s)", exc.code, exc_info=exc)
        raise HTTPException(status_code=502, detail="OpenF1 proxy error")
    except URLError as exc:
        _logger.warning("OpenF1 proxy failed (network)", exc_info=exc)
        raise HTTPException(status_code=502, detail="OpenF1 proxy error")

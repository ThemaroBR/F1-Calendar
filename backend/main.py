from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import Race
from .services import is_valid_timezone, next_race, race_to_timezone
from .storage import load_races
from .settings import (
    API_TITLE,
    CORS_ALLOW_CREDENTIALS,
    CORS_ALLOW_HEADERS,
    CORS_ALLOW_METHODS,
    CORS_ALLOW_ORIGINS,
)

app = FastAPI(title=API_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=CORS_ALLOW_METHODS,
    allow_headers=CORS_ALLOW_HEADERS,
)


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

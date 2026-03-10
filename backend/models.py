from datetime import datetime

from pydantic import BaseModel


class Race(BaseModel):
    name: str
    track: str
    country_name: str | None = None
    country_code: str | None = None
    start: datetime
    sessions: dict[str, datetime]  # e.g. {'FP1': datetime, 'Qualifying': datetime, 'Race': datetime}

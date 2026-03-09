from datetime import datetime

from pydantic import BaseModel


class Race(BaseModel):
    name: str
    track: str
    start: datetime
    sessions: dict[str, datetime]  # e.g. {'FP1': datetime, 'Qualifying': datetime, 'Race': datetime}

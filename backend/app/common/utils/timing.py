"""
Stage timing for slow request paths.

An email send downloads, renders, compresses and uploads inside one request;
this records how long each stage took so one log line shows where the time
went.
"""

import time


class StageTimer:
    """Wall-clock time of consecutive stages of one operation.

    lap(name) closes the stage that ran since the previous lap (or since the
    timer started). A name lapped more than once adds up, so a stage repeated
    per attachment reports its combined time.
    """

    def __init__(self):
        self.started = self._last = time.monotonic()
        self.stages = {}

    def lap(self, name: str) -> None:
        now = time.monotonic()
        self.stages[name] = self.stages.get(name, 0.0) + (now - self._last)
        self._last = now

    def summary(self) -> str:
        """e.g. "7.52s (connect 0.41s, login 0.30s, upload 2.10s)"."""
        total = time.monotonic() - self.started
        parts = ", ".join(f"{name} {seconds:.2f}s" for name, seconds in self.stages.items())
        return f"{total:.2f}s ({parts})" if parts else f"{total:.2f}s"

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4, uuid5
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger
from jsonschema import Draft202012Validator


SCHEDULE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["name", "workflow", "model_id", "time", "timezone", "weekdays"],
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 200, "pattern": r"\S"},
        "workflow": {"type": "string", "minLength": 1},
        "model_id": {"type": "string", "minLength": 1},
        "time": {"type": "string", "pattern": r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"},
        "timezone": {"type": "string", "minLength": 1},
        "weekdays": {"type": "array", "minItems": 1, "uniqueItems": True,
                     "items": {"type": "integer", "minimum": 0, "maximum": 6}},
        "setup": {"type": "object"},
        "enabled": {"type": "boolean"},
        "auto_approve": {"type": "boolean"},
        "max_retries": {"type": "integer", "minimum": 0, "maximum": 3},
        "catch_up": {"type": "boolean"},
        "publish": {"type": "boolean"},
    },
}


def schedule_trigger(config: dict) -> CronTrigger:
    error = next(Draft202012Validator(SCHEDULE_SCHEMA).iter_errors(config), None)
    if error:
        raise ValueError(error.message)
    hour, minute = config["time"].split(":")
    try:
        zone = ZoneInfo(config["timezone"])
    except (KeyError, ValueError) as exc:
        raise ValueError("Choose a valid IANA timezone.") from exc
    return CronTrigger(hour=int(hour), minute=int(minute),
                       day_of_week=",".join(str(day) for day in config["weekdays"]), timezone=zone)


def next_occurrence(config: dict, after: datetime) -> str:
    if after.tzinfo is None:
        raise ValueError("Scheduling requires an aware timestamp.")
    result = schedule_trigger(config).get_next_fire_time(None, after + timedelta(seconds=1))
    if result is None:
        raise ValueError("No future occurrence.")
    return result.astimezone(timezone.utc).isoformat()


class ScheduleStore:
    def __init__(self, home: Path):
        self.root = Path(home) / "scheduling"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / "schedules.sqlite3"
        if self.root.is_symlink() or self.path.is_symlink():
            raise ValueError("Schedule storage cannot be a symlink.")
        with self.connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS schedules (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, config TEXT NOT NULL,
                    next_at TEXT NOT NULL, enabled INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrences (
                    id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, scheduled_for TEXT NOT NULL,
                    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                    retry_at TEXT, message TEXT NOT NULL DEFAULT '',
                    UNIQUE(schedule_id, scheduled_for)
                );
                CREATE TABLE IF NOT EXISTS publications (
                    schedule_id TEXT PRIMARY KEY, state TEXT NOT NULL, published_at TEXT NOT NULL
                );
            """)

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def save(self, owner: str, config: dict, *, identifier: str | None = None,
             now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        next_at = next_occurrence(config, now)
        identifier = UUID(str(identifier)).hex if identifier else uuid4().hex
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute("SELECT owner FROM schedules WHERE id = ?", (identifier,)).fetchone()
            if existing and existing["owner"] != owner:
                raise ValueError("Schedule not found.")
            connection.execute("""INSERT INTO schedules VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET config=excluded.config, next_at=excluded.next_at,
                enabled=excluded.enabled""",
                (identifier, owner, json.dumps(config), next_at, int(config.get("enabled", True))))
        return self.get(identifier)

    @staticmethod
    def decode(row) -> dict:
        return {**dict(row), "config": json.loads(row["config"]), "enabled": bool(row["enabled"])}

    def get(self, identifier: str) -> dict:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM schedules WHERE id = ?", (identifier,)).fetchone()
            if row is None:
                raise ValueError("Schedule not found.")
            return self.decode(row)

    def list(self, owner: str) -> list[dict]:
        with self.connection() as connection:
            return [self.decode(row) for row in connection.execute(
                "SELECT * FROM schedules WHERE owner = ? ORDER BY next_at", (owner,))]

    def history(self, identifier: str) -> list[dict]:
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(
                "SELECT * FROM occurrences WHERE schedule_id = ? ORDER BY scheduled_for DESC LIMIT 50",
                (identifier,))]

    def claim_due(self, now: datetime) -> list[dict]:
        timestamp = now.astimezone(timezone.utc).isoformat()
        claimed = []
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for row in connection.execute("SELECT * FROM schedules WHERE enabled = 1 AND next_at <= ?", (timestamp,)).fetchall():
                schedule = self.decode(row)
                config = schedule["config"]
                active = connection.execute("SELECT 1 FROM occurrences WHERE schedule_id = ? AND status IN ('running', 'retry')",
                                            (row["id"],)).fetchone()
                missed = now - datetime.fromisoformat(row["next_at"]) > timedelta(minutes=1)
                occurrence_status = "skipped" if active or (missed and not config.get("catch_up")) else "running"
                identifier = uuid5(UUID(row["id"]), row["next_at"]).hex
                inserted = connection.execute("INSERT OR IGNORE INTO occurrences (id, schedule_id, scheduled_for, status, message) VALUES (?, ?, ?, ?, ?)",
                                   (identifier, row["id"], row["next_at"], occurrence_status,
                                    "Overlapping run" if active else "Missed occurrence" if occurrence_status == "skipped" else ""))
                connection.execute("UPDATE schedules SET next_at = ? WHERE id = ?", (next_occurrence(config, now), row["id"]))
                if occurrence_status == "running" and inserted.rowcount:
                    claimed.append({"id": identifier, "schedule_id": row["id"], "scheduled_for": row["next_at"], "attempts": 0})
            for row in connection.execute("""SELECT occurrences.* FROM occurrences JOIN schedules ON schedules.id=occurrences.schedule_id
                    WHERE status='retry' AND retry_at <= ? AND schedules.enabled=1""", (timestamp,)).fetchall():
                connection.execute("UPDATE occurrences SET status='running' WHERE id=?", (row["id"],))
                claimed.append(dict(row))
        return claimed

    def finish(self, occurrence: dict, status: str, message: str = "", *, retry_at: str | None = None):
        if status not in {"completed", "needs_attention", "retry", "failed"}:
            raise ValueError("Invalid occurrence status.")
        with self.connection() as connection:
            connection.execute("UPDATE occurrences SET status=?, message=?, attempts=attempts+1, retry_at=? WHERE id=?",
                               (status, message, retry_at, occurrence["id"]))

    def recover(self):
        with self.connection() as connection:
            connection.execute("UPDATE occurrences SET status='needs_attention', message='Backend stopped; inspect partial outputs before resuming.' WHERE status='running'")

    def resolve(self, identifier: str):
        """Mark a needs-attention occurrence completed after its run was resumed in the session."""
        with self.connection() as connection:
            connection.execute("UPDATE occurrences SET status='completed', message='Completed after resuming in the session.' "
                               "WHERE id=? AND status='needs_attention'", (identifier,))

    def forget(self, identifier: str):
        """Drop a finished occurrence whose session was deleted; active runs are kept."""
        with self.connection() as connection:
            connection.execute("DELETE FROM occurrences WHERE id=? AND status NOT IN ('running', 'retry')", (identifier,))

    def delete(self, owner: str, identifier: str):
        """Remove a schedule, its run history, and any publication; run sessions themselves are kept."""
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM schedules WHERE id=? AND owner=?", (identifier, owner)).fetchone() is None:
                raise ValueError("Schedule not found.")
            connection.execute("DELETE FROM publications WHERE schedule_id=?", (identifier,))
            connection.execute("DELETE FROM occurrences WHERE schedule_id=?", (identifier,))
            connection.execute("DELETE FROM schedules WHERE id=?", (identifier,))

    def publish(self, schedule_id: str, state: dict):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT config, enabled FROM schedules WHERE id=?", (schedule_id,)).fetchone()
            if row is None or not row["enabled"] or not json.loads(row["config"]).get("publish"):
                return
            connection.execute("INSERT OR REPLACE INTO publications VALUES (?, ?, ?)",
                               (schedule_id, json.dumps(state, allow_nan=False), datetime.now(timezone.utc).isoformat()))

    def withdraw(self, owner: str, identifier: str):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT config FROM schedules WHERE id=? AND owner=?", (identifier, owner)).fetchone()
            if row is None:
                raise ValueError("Schedule not found.")
            config = {**json.loads(row["config"]), "enabled": False, "publish": False}
            connection.execute("UPDATE schedules SET config=?, enabled=0 WHERE id=?", (json.dumps(config), identifier))
            connection.execute("DELETE FROM publications WHERE schedule_id=?", (identifier,))

    def publications(self) -> list[dict]:
        with self.connection() as connection:
            return [{"id": "shared-" + row["schedule_id"], "published_at": row["published_at"],
                     "display_name": row["display_name"],
                     "scheduled_run": json.loads(row["scheduled_run"]) if row["scheduled_run"] else None}
                    for row in connection.execute("""SELECT schedule_id, published_at,
                        json_extract(state, '$.activeWorkspace.displayName') AS display_name,
                        json_extract(state, '$.activeWorkspace.scheduledRun') AS scheduled_run FROM publications""")]

    def publication(self, workspace_id: str) -> dict | None:
        if not workspace_id.startswith("shared-"):
            return None
        with self.connection() as connection:
            row = connection.execute("SELECT state FROM publications WHERE schedule_id=?",
                                     (workspace_id.removeprefix("shared-"),)).fetchone()
        return json.loads(row["state"]) if row else None
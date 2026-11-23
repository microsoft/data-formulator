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

from data_formulator.workflows.instances import SCHEDULE_SCHEMA


# The fields of a workflow's ``schedule:`` block that set when it runs; changing them moves the next run.
TIMING = ("time", "weekdays", "timezone")


def schedule_trigger(config: dict) -> CronTrigger:
    """The trigger for a workflow's ``schedule:`` block (or an index row's config, which adds ``workflow`` and
    ``site``)."""
    block = {key: value for key, value in config.items() if key not in ("workflow", "site")}
    error = next(Draft202012Validator(SCHEDULE_SCHEMA).iter_errors(block), None)
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




def _same_timing(left: dict, right: dict) -> bool:
    return all(sorted(left.get(key) or []) == sorted(right.get(key) or []) if key == "weekdays"
               else left.get(key) == right.get(key) for key in TIMING)


class ScheduleStore:
    """The scheduler's index of workflow schedules, and their run history.

    A workflow's ``schedule:`` block is the definition. Each row mirrors one workflow's block, keyed by
    (owner, space, workflow path); ``site`` is ``""`` for the standard app. A row whose block was removed stays,
    unscheduled, while it has runs, so those runs stay listed with the workflow.
    """

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
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(schedules)")}
            if "workflow" not in columns:
                # Schedules made before they lived in workflow files: their space and workflow were in the config.
                connection.execute("ALTER TABLE schedules ADD COLUMN site TEXT NOT NULL DEFAULT ''")
                connection.execute("ALTER TABLE schedules ADD COLUMN workflow TEXT NOT NULL DEFAULT ''")
                connection.execute("ALTER TABLE schedules ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 1")
                connection.execute("UPDATE schedules SET site = COALESCE(json_extract(config, '$.site'), ''), "
                                   "workflow = COALESCE(json_extract(config, '$.workflow'), '')")

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def decode(row) -> dict:
        return {**dict(row), "config": json.loads(row["config"]), "enabled": bool(row["enabled"]),
                "scheduled": bool(row["scheduled"])}

    def get(self, identifier: str) -> dict:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM schedules WHERE id = ?", (identifier,)).fetchone()
            if row is None:
                raise ValueError("Schedule not found.")
            return self.decode(row)

    def find(self, owner: str, site: str | None, workflow: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM schedules WHERE owner = ? AND site = ? AND workflow = ? ORDER BY rowid LIMIT 1",
                                     (owner, site or "", workflow)).fetchone()
            return self.decode(row) if row else None

    def list(self, owner: str, site: str | None = None) -> list[dict]:
        """The owner's rows in one scope (the standard app when ``site`` is None)."""
        with self.connection() as connection:
            return [self.decode(row) for row in connection.execute(
                "SELECT * FROM schedules WHERE owner = ? AND site = ? ORDER BY next_at", (owner, site or ""))]

    def scopes(self) -> list[tuple[str, str | None]]:
        """Every (owner, space) with a row."""
        with self.connection() as connection:
            return [(row["owner"], row["site"] or None) for row in
                    connection.execute("SELECT DISTINCT owner, site FROM schedules")]

    def sync(self, owner: str, site: str | None, workflow: str, schedule: dict | None, *,
             now: datetime | None = None) -> dict | None:
        """Make the workflow's row match its ``schedule:`` block (None: the file has none)."""
        now = now or datetime.now(timezone.utc)
        site = site or ""
        config = None
        if schedule is not None:
            config = {**schedule, "workflow": workflow, **({"site": site} if site else {})}
            schedule_trigger(config)
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM schedules WHERE owner = ? AND site = ? AND workflow = ? ORDER BY rowid LIMIT 1",
                                     (owner, site, workflow)).fetchone()
            if config is None:
                if row is None:
                    return None
                if connection.execute("SELECT 1 FROM occurrences WHERE schedule_id = ?", (row["id"],)).fetchone():
                    connection.execute("UPDATE schedules SET scheduled = 0, enabled = 0 WHERE id = ?", (row["id"],))
                else:
                    connection.execute("DELETE FROM schedules WHERE id = ?", (row["id"],))
                    return None
            else:
                enabled = bool(config.get("enabled", True))
                if row is None:
                    identifier = uuid4().hex
                    connection.execute("INSERT INTO schedules (id, owner, config, next_at, enabled, site, workflow, scheduled) "
                                       "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                                       (identifier, owner, json.dumps(config), next_occurrence(config, now), int(enabled), site, workflow))
                    row = {"id": identifier}
                else:
                    was_running = bool(row["enabled"]) and bool(row["scheduled"])
                    keep = was_running and _same_timing(json.loads(row["config"]), config)
                    connection.execute("UPDATE schedules SET config = ?, next_at = ?, enabled = ?, scheduled = 1 WHERE id = ?",
                                       (json.dumps(config), row["next_at"] if keep else next_occurrence(config, now),
                                        int(enabled), row["id"]))
            return self.decode(connection.execute("SELECT * FROM schedules WHERE id = ?", (row["id"],)).fetchone())

    def rebuild(self, owner: str, site: str | None, schedules: dict[str, dict | None], *, now: datetime | None = None):
        """Sync every workflow in one scope (its path -> its block, or None); rows of workflows not listed are
        unscheduled. A block that no longer validates leaves the workflow unscheduled."""
        for row in self.list(owner, site):
            if row["workflow"] not in schedules:
                self.sync(owner, site, row["workflow"], None, now=now)
        for workflow, schedule in schedules.items():
            try:
                self.sync(owner, site, workflow, schedule, now=now)
            except ValueError:
                self.sync(owner, site, workflow, None, now=now)

    def remove(self, owner: str, site: str | None, workflow: str) -> list[str]:
        """Forget a deleted workflow's row and run history; return its occurrence ids (its run sessions are
        ``scheduled-<id>``)."""
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = [row["id"] for row in connection.execute(
                "SELECT id FROM schedules WHERE owner = ? AND site = ? AND workflow = ?", (owner, site or "", workflow))]
            occurrences = []
            for identifier in rows:
                occurrences += [row["id"] for row in connection.execute(
                    "SELECT id FROM occurrences WHERE schedule_id = ?", (identifier,))]
                connection.execute("DELETE FROM occurrences WHERE schedule_id = ?", (identifier,))
                connection.execute("DELETE FROM schedules WHERE id = ?", (identifier,))
            return occurrences

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
            for row in connection.execute("SELECT * FROM schedules WHERE enabled = 1 AND scheduled = 1 AND next_at <= ?",
                                          (timestamp,)).fetchall():
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
        if status not in {"completed", "needs_attention", "retry", "failed", "skipped"}:
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

    # Moving schedules from rows into workflow files, once (scheduler.migrate_to_files).

    def moved_to_files(self) -> bool:
        with self.connection() as connection:
            return connection.execute("SELECT 1 FROM meta WHERE key = 'files'").fetchone() is not None

    def mark_moved_to_files(self):
        with self.connection() as connection:
            connection.execute("INSERT OR IGNORE INTO meta VALUES ('files', 'yes')")

    def all_rows(self) -> list[dict]:
        with self.connection() as connection:
            return [self.decode(row) for row in connection.execute("SELECT * FROM schedules ORDER BY next_at")]

    def retarget(self, identifier: str, workflow: str, *, scheduled: bool = True):
        """Point a row at another workflow file (a copy made for it); unscheduled rows stop running."""
        with self.connection() as connection:
            row = connection.execute("SELECT config FROM schedules WHERE id = ?", (identifier,)).fetchone()
            config = {**json.loads(row["config"]), "workflow": workflow}
            connection.execute("UPDATE schedules SET workflow = ?, config = ?, scheduled = ?, enabled = enabled * ? WHERE id = ?",
                               (workflow, json.dumps(config), int(scheduled), int(scheduled), identifier))

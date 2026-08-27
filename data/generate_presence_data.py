"""Generate synthetic desk presence data from data/device-inventory.csv.

Produces data/device-presence.csv with one row per desk sensor per hour:
    deviceId, name, timestamp, occupiedMinutes, occupied

Only Pressac desk occupancy sensors are included (deviceId starting with
"05"); the Teltronica modems and EnOcean repeaters carry no presence signal.
Rows start at each device's createdAt, so sensors onboarded mid-period
only report from that point on.

Seeded so the output is reproducible: python3 data/generate_presence_data.py
"""

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

PERIOD_START = datetime(2026, 8, 10, 0, 0, tzinfo=timezone.utc)  # Monday
PERIOD_END = datetime(2026, 8, 24, 0, 0, tzinfo=timezone.utc)    # two weeks

DATA_DIR = Path(__file__).parent
rng = random.Random(42)


def load_desk_sensors():
    sensors = []
    with open(DATA_DIR / "device-inventory.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row["deviceId"].startswith("05"):
                continue
            created = datetime.fromisoformat(row["createdAt"].replace("Z", "+00:00"))
            sensors.append({"deviceId": row["deviceId"], "name": row["name"], "created": created})
    return sensors


def hourly_occupancy_probability(ts, busyness):
    """Probability that the desk sees any use during the hour starting at ts."""
    if ts.weekday() >= 5:  # weekend
        return 0.01
    hour = ts.hour
    base = {
        7: 0.25, 8: 0.65, 9: 0.85, 10: 0.85, 11: 0.55,  # lunch dip starts
        12: 0.60, 13: 0.80, 14: 0.80, 15: 0.70, 16: 0.45, 17: 0.15, 18: 0.05,
    }.get(hour, 0.0)
    return min(1.0, base * busyness)


def occupied_minutes(prob):
    if rng.random() >= prob:
        return 0
    # When the desk is used at all, it is mostly used for a large part of the hour.
    return min(60, max(5, int(rng.gauss(45, 12))))


def main():
    sensors = load_desk_sensors()
    rows = []
    for sensor in sensors:
        # Each desk has a stable popularity: some are favorites, some rarely used.
        busyness = max(0.15, min(1.3, rng.gauss(0.9, 0.25)))
        ts = PERIOD_START
        while ts < PERIOD_END:
            if ts >= sensor["created"]:
                minutes = occupied_minutes(hourly_occupancy_probability(ts, busyness))
                rows.append(
                    {
                        "deviceId": sensor["deviceId"],
                        "name": sensor["name"],
                        "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "occupiedMinutes": minutes,
                        "occupied": str(minutes > 0).lower(),
                    }
                )
            ts += timedelta(hours=1)

    out = DATA_DIR / "device-presence.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["deviceId", "name", "timestamp", "occupiedMinutes", "occupied"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows for {len(sensors)} sensors to {out}")


if __name__ == "__main__":
    main()

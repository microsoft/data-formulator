# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Demo data REST APIs for streaming/refresh demos.

Design Philosophy:
- Each endpoint returns a COMPLETE dataset (not just a single row)
- Datasets are meaningful on their own for analysis/visualization
- When refreshed, datasets change over time:
  * New rows may be added (accumulating data)
  * Existing values may update (latest readings)
- This allows tracking trends, changes, and patterns over time

Example Use Cases:
- Stock prices: "Last 30 days" grows daily with new data
- ISS position: Track trajectory over last N minutes
- Earthquakes: All quakes since a start date accumulates

Rate Limiting:
- External API routes are rate-limited to prevent abuse
- Limits are set per IP address using Flask-Limiter
"""

import os
import random
import logging
import requests
import io
import csv
import math
from datetime import datetime, timedelta
from flask import Blueprint, Response, request, jsonify
from typing import Any
from collections import deque
import threading

logger = logging.getLogger(__name__)

demo_stream_bp = Blueprint('demo_stream', __name__, url_prefix='/api/demo-stream')


@demo_stream_bp.after_request
def _set_cors(response):
    """Set CORS headers from CORS_ORIGIN env-var (same logic as agent_routes)."""
    origin = os.environ.get('CORS_ORIGIN', '')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
    return response

# ============================================================================
# Rate Limiting Configuration
# ============================================================================
# Uses Flask-Limiter with deferred app initialization to avoid circular imports.
# The limiter is created here and init_app() is called from app.py.

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Create limiter without app - will be initialized via init_app() in app.py
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],  # No default limits - only apply to specific routes
    storage_uri="memory://",
    strategy="fixed-window",
)

# Rate limit strings for different endpoint types
# These are applied to routes that call external APIs

# ISS API (open-notify.org) - generous limits
ISS_RATE_LIMIT = "30 per minute"

# USGS Earthquake API - allow reasonable queries
EARTHQUAKE_RATE_LIMIT = "20 per minute"

# Weather APIs (Open-Meteo, NWS) - moderate limits
WEATHER_RATE_LIMIT = "20 per minute"

# yfinance API - more restrictive due to Yahoo's limits
YFINANCE_RATE_LIMIT = "10 per minute"

# Simulated/mock data - no external calls, more generous
MOCK_RATE_LIMIT = "60 per minute"

# Try to import yfinance
import yfinance as yf


# ============================================================================
# Helper Functions
# ============================================================================

def make_csv_response(rows: list, filename: str = "data.csv") -> Response:
    """Convert list of dicts to CSV text response"""
    if not rows:
        return Response("", mimetype='text/csv')
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    
    return Response(
        output.getvalue(),
        mimetype='text/csv',
    )


# ============================================================================
# ISS Location Tracking - Real-time trajectory
# Returns accumulated position history that grows over time
# Background thread automatically collects positions every 5 seconds
# ============================================================================

# Thread-safe storage for ISS position history
_iss_track_lock = threading.Lock()
_iss_track_history: deque = deque(maxlen=10000)  # Keep last 10000 positions
_iss_last_fetch: datetime | None = None
_iss_collector_started = False

def _fetch_iss_position() -> dict[str, Any] | None:
    """Fetch current ISS position from API"""
    try:
        response = requests.get("http://api.open-notify.org/iss-now.json", timeout=10)
        response.raise_for_status()
        data = response.json()
        position = data.get("iss_position", {})
        return {
            "timestamp": datetime.utcfromtimestamp(data.get("timestamp", 0)).isoformat() + "Z",
            "latitude": float(position.get("latitude", 0)),
            "longitude": float(position.get("longitude", 0)),
        }
    except Exception as e:
        logger.warning(f"Failed to fetch ISS position: {e}")
        return None


def _iss_collector_loop():
    """Background thread that continuously collects ISS positions every 5 seconds."""
    global _iss_last_fetch
    logger.info("ISS position collector started")
    while True:
        try:
            position = _fetch_iss_position()
            if position:
                now = datetime.utcnow()
                position["fetched_at"] = now.isoformat() + "Z"
                with _iss_track_lock:
                    _iss_track_history.append(position)
                    _iss_last_fetch = now
        except Exception as e:
            logger.warning(f"ISS collector error: {e}")
        threading.Event().wait(10)  # Sleep 10 seconds between fetches


def start_iss_collector():
    """Start the background ISS position collector if not already running."""
    global _iss_collector_started
    if _iss_collector_started:
        return
    _iss_collector_started = True
    t = threading.Thread(target=_iss_collector_loop, daemon=True)
    t.start()


@demo_stream_bp.route('/iss', methods=['GET'])
@limiter.limit(ISS_RATE_LIMIT)
def get_iss():
    """
    ISS position trajectory over time. Positions are collected automatically
    in the background every 5 seconds.
    
    Query params:
        - minutes: How many minutes of history to return (default: 1440, max: 1440)
        - limit: Max number of points to return (default: 10000, max: 10000)
    
    The ISS completes one orbit in ~90 minutes, so 30 min shows ~1/3 of orbit.
    """
    # Ensure the collector is running
    start_iss_collector()
    
    minutes = min(1440, max(1, int(request.args.get('minutes', 1440))))
    limit = min(10000, max(1000, int(request.args.get('limit', 10000))))
    
    now = datetime.utcnow()
    cutoff = now - timedelta(minutes=minutes)
    
    with _iss_track_lock:
        # Filter to requested time window and limit
        rows = []
        for pos in _iss_track_history:
            try:
                pos_time = datetime.fromisoformat(pos["timestamp"].replace("Z", "+00:00")).replace(tzinfo=None)
                if pos_time >= cutoff:
                    rows.append(pos)
            except:
                continue
        
        # Limit and sort by time
        rows = sorted(rows, key=lambda x: x["timestamp"])[-limit:]
    
    # If we have no data yet (just started), do a one-time fetch
    if not rows:
        position = _fetch_iss_position()
        if position:
            position["fetched_at"] = now.isoformat() + "Z"
            rows = [position]
    
    return make_csv_response(rows)


@demo_stream_bp.route('/iss/reset', methods=['POST'])
def reset_iss():
    """Clear all accumulated ISS position history and start fresh."""
    with _iss_track_lock:
        _iss_track_history.clear()
    return jsonify({"status": "ok", "message": "ISS position history cleared"})


# ============================================================================
# USGS Earthquakes - Accumulating dataset of seismic events
# Data naturally grows over time as new earthquakes occur
# Recommended refresh: 60 seconds
# ============================================================================

@demo_stream_bp.route('/earthquakes', methods=['GET'])
@limiter.limit(EARTHQUAKE_RATE_LIMIT)
def get_earthquakes():
    """
    Earthquakes from USGS. Dataset grows as new quakes occur.
    
    Query params:
        - timeframe: 'hour', 'day', 'week', 'month' (default: 'day')
        - min_magnitude: Minimum magnitude filter (default: 0)
        - max_magnitude: Maximum magnitude filter (optional)
        - since: ISO date string - only return quakes after this time
        - limit: Maximum number of results (default: 20000, max: 20000)
        - use_query_api: 'true' to use query API for more data (default: 'false' for quick summary)
    
    Use case:
        - Set timeframe='week' to see a week of earthquake data
        - Each refresh may show new earthquakes that occurred
        - Use min_magnitude to filter for significant quakes (e.g., 4.0+)
        - Set use_query_api=true and limit=10000 to get large datasets
    
    Recommended refresh: 60 seconds
    """
    timeframe = request.args.get('timeframe', 'day')
    min_magnitude = float(request.args.get('min_magnitude', 0))
    max_magnitude = request.args.get('max_magnitude')
    since_str = request.args.get('since')
    limit = min(20000, max(1, int(request.args.get('limit', 20000))))
    use_query_api = request.args.get('use_query_api', 'false').lower() == 'true'
    
    fetched_at = datetime.utcnow().isoformat() + "Z"
    rows = []
    
    # Parse 'since' filter if provided
    since_timestamp = None
    if since_str:
        try:
            since_dt = datetime.fromisoformat(since_str.replace("Z", "+00:00")).replace(tzinfo=None)
            since_timestamp = since_dt.timestamp() * 1000  # USGS uses milliseconds
        except:
            pass
    
    try:
        if use_query_api or limit > 1000:
            # Use USGS Query API for larger datasets
            now = datetime.utcnow()
            timeframe_deltas = {
                "hour": timedelta(hours=1),
                "day": timedelta(days=1),
                "week": timedelta(weeks=1),
                "month": timedelta(days=30)
            }
            start_time = now - timeframe_deltas.get(timeframe, timedelta(days=1))
            
            params = {
                "format": "geojson",
                "starttime": start_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "endtime": now.strftime("%Y-%m-%dT%H:%M:%S"),
                "minmagnitude": min_magnitude,
                "limit": limit,
                "orderby": "time"  # Most recent first
            }
            
            if max_magnitude:
                params["maxmagnitude"] = float(max_magnitude)
            
            url = "https://earthquake.usgs.gov/fdsnws/event/1/query"
            response = requests.get(url, params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
        else:
            # Use summary feeds for quick queries
            feeds = {"hour": "all_hour", "day": "all_day", "week": "all_week", "month": "all_month"}
            feed = feeds.get(timeframe, "all_day")
            url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson"
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
        
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates", [0, 0, 0])
            
            # Filter by magnitude (additional client-side filter for summary feeds)
            mag = props.get("mag")
            if mag is not None:
                if mag < min_magnitude:
                    continue
                if max_magnitude and mag > float(max_magnitude):
                    continue
            
            # Filter by 'since' time
            quake_time = props.get("time", 0)
            if since_timestamp and quake_time <= since_timestamp:
                continue
            
            rows.append({
                "id": feature.get("id"),
                "time": datetime.utcfromtimestamp(quake_time / 1000).isoformat() + "Z",
                "latitude": coords[1] if len(coords) > 1 else None,
                "longitude": coords[0] if len(coords) > 0 else None,
                "depth_km": coords[2] if len(coords) > 2 else None,
                "magnitude": mag,
                "place": props.get("place"),
                "type": props.get("type", "earthquake"),
                "status": props.get("status"),
                "felt": props.get("felt"),  # Number of people who reported feeling it
                "cdi": props.get("cdi"),  # Maximum reported intensity
                "mmi": props.get("mmi"),  # Maximum estimated instrumental intensity
                "tsunami": props.get("tsunami", 0),  # Tsunami warning (0 or 1)
                "sig": props.get("sig"),  # Significance (0-1000)
                "net": props.get("net"),  # Network that reported the event
                "code": props.get("code"),  # Event code
                "url": props.get("url"),  # USGS detail page URL
                "fetched_at": fetched_at
            })
            
            # Limit results if using summary feed
            if not use_query_api and len(rows) >= limit:
                break
        
        # Sort by time, most recent first
        rows.sort(key=lambda x: x["time"], reverse=True)
        
        # Apply limit (in case summary feed returned more than requested)
        if len(rows) > limit:
            rows = rows[:limit]
        
        return make_csv_response(rows)
    except Exception as e:
        logger.warning(f"Failed to fetch earthquakes: {e}")
        return Response(f"error,{str(e)}", mimetype='text/csv'), 500


# ============================================================================
# Current Weather (Open-Meteo) - Updates every 15 minutes
# Recommended refresh: 300 seconds
# ============================================================================

WEATHER_CITIES = [
    {"name": "Seattle", "lat": 47.6062, "lon": -122.3321, "state": "WA"},
    {"name": "New York", "lat": 40.7128, "lon": -74.0060, "state": "NY"},
    {"name": "Los Angeles", "lat": 34.0522, "lon": -118.2437, "state": "CA"},
    {"name": "Chicago", "lat": 41.8781, "lon": -87.6298, "state": "IL"},
    {"name": "Miami", "lat": 25.7617, "lon": -80.1918, "state": "FL"},
    {"name": "Denver", "lat": 39.7392, "lon": -104.9903, "state": "CO"},
    {"name": "Boston", "lat": 42.3601, "lon": -71.0589, "state": "MA"},
    {"name": "Phoenix", "lat": 33.4484, "lon": -112.0740, "state": "AZ"},
    {"name": "Atlanta", "lat": 33.7490, "lon": -84.3880, "state": "GA"},
    {"name": "Dallas", "lat": 32.7767, "lon": -96.7970, "state": "TX"},
    {"name": "Houston", "lat": 29.7604, "lon": -95.3698, "state": "TX"},
    {"name": "Portland", "lat": 45.5152, "lon": -122.6784, "state": "OR"},
    {"name": "San Francisco", "lat": 37.7749, "lon": -122.4194, "state": "CA"},
    {"name": "Las Vegas", "lat": 36.1699, "lon": -115.1398, "state": "NV"},
    {"name": "Minneapolis", "lat": 44.9778, "lon": -93.2650, "state": "MN"},
    {"name": "Detroit", "lat": 42.3314, "lon": -83.0458, "state": "MI"},
    {"name": "Philadelphia", "lat": 39.9526, "lon": -75.1652, "state": "PA"},
    {"name": "Washington", "lat": 38.9072, "lon": -77.0369, "state": "DC"},
    {"name": "Nashville", "lat": 36.1627, "lon": -86.7816, "state": "TN"},
    {"name": "New Orleans", "lat": 29.9511, "lon": -90.0715, "state": "LA"},
]

@demo_stream_bp.route('/weather', methods=['GET'])
@limiter.limit(WEATHER_RATE_LIMIT)
def get_weather():
    """
    Current weather for major US cities. Updates every 15 minutes.
    
    Query params:
        - cities: Comma-separated list of city names (default: all cities)
                  Example: cities=Seattle,New York,Los Angeles
        - fields: Comma-separated list of fields to include (default: all)
                  Available: temperature,humidity,wind,precipitation,pressure,cloud_cover
    
    Recommended refresh: 300 seconds
    """
    fetched_at = datetime.utcnow().isoformat() + "Z"
    rows = []
    
    # Parse city filter
    cities_param = request.args.get('cities', '').strip()
    if cities_param:
        city_names = [c.strip() for c in cities_param.split(',')]
        cities_to_fetch = [c for c in WEATHER_CITIES if c["name"] in city_names]
        if not cities_to_fetch:
            # If no matches, use all cities
            cities_to_fetch = WEATHER_CITIES
    else:
        cities_to_fetch = WEATHER_CITIES
    
    # Parse fields filter
    fields_param = request.args.get('fields', '').strip()
    include_all = not fields_param
    include_temp = include_all or 'temperature' in fields_param
    include_humidity = include_all or 'humidity' in fields_param
    include_wind = include_all or 'wind' in fields_param
    include_precip = include_all or 'precipitation' in fields_param
    include_pressure = include_all or 'pressure' in fields_param
    include_cloud = include_all or 'cloud_cover' in fields_param
    
    for city in cities_to_fetch:
        try:
            # Build current weather parameters
            current_fields = []
            if include_temp:
                current_fields.append("temperature_2m")
            if include_humidity:
                current_fields.append("relative_humidity_2m")
            if include_wind:
                current_fields.extend(["wind_speed_10m", "wind_direction_10m"])
            if include_precip:
                current_fields.append("precipitation")
            if include_pressure:
                current_fields.append("surface_pressure")
            if include_cloud:
                current_fields.append("cloud_cover")
            
            if not current_fields:
                current_fields = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]
            
            params = {
                "latitude": city["lat"],
                "longitude": city["lon"],
                "current": ",".join(current_fields),
                "timezone": "auto"
            }
            response = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            current = data.get("current", {})
            
            row = {
                "city": city["name"],
                "state": city.get("state", ""),
                "latitude": city["lat"],
                "longitude": city["lon"],
                "fetched_at": fetched_at
            }
            
            if include_temp:
                row["temperature_c"] = current.get("temperature_2m")
            if include_humidity:
                row["humidity_percent"] = current.get("relative_humidity_2m")
            if include_wind:
                row["wind_speed_kmh"] = current.get("wind_speed_10m")
                row["wind_direction_deg"] = current.get("wind_direction_10m")
            if include_precip:
                row["precipitation_mm"] = current.get("precipitation")
            if include_pressure:
                row["pressure_hpa"] = current.get("surface_pressure")
            if include_cloud:
                row["cloud_cover_percent"] = current.get("cloud_cover")
            
            rows.append(row)
        except Exception as e:
            logger.warning(f"Failed to fetch weather for {city['name']}: {e}")
    
    return make_csv_response(rows)


# ============================================================================
# Weather History (Open-Meteo) - Past days of hourly data
# Dataset grows as new hours pass
# ============================================================================

@demo_stream_bp.route('/weather/history', methods=['GET'])
@limiter.limit(WEATHER_RATE_LIMIT)
def get_weather_history():
    """
    Hourly weather history for one or more locations. Dataset grows with each hour.
    
    Query params:
        - city: City name (default: Seattle) - one of the WEATHER_CITIES
                  Can also be comma-separated list: city=Seattle,New York,Los Angeles
        - cities: Alternative parameter name for comma-separated list of city names
        - days: Number of past days to include (default: 7, max: 92 for archive, 14 for forecast)
        - use_archive: 'true' to use historical archive API (for data older than 5 days, default: 'auto')
    
    Use case:
        - Track temperature/weather trends over the past week
        - Each hour, a new row appears in the dataset
        - Great for visualizing weather patterns
        - Use days=30 with use_archive=true for month-long analysis
        - Compare weather history across multiple cities
    
    Recommended refresh: 3600 seconds (hourly)
    """
    # Support both 'city' and 'cities' parameters for backward compatibility
    city_param = request.args.get('city', '').strip()
    cities_param = request.args.get('cities', '').strip()
    
    # Use cities if provided, otherwise fall back to city
    cities_input = cities_param if cities_param else city_param
    
    days = min(92, max(1, int(request.args.get('days', 7))))
    use_archive_param = request.args.get('use_archive', 'auto').lower()
    
    # Parse city filter - support both single city and comma-separated list
    if cities_input:
        city_names = [c.strip() for c in cities_input.split(',')]
        cities_to_fetch = [c for c in WEATHER_CITIES if c["name"] in city_names]
        if not cities_to_fetch:
            # If no matches, default to Seattle
            cities_to_fetch = [WEATHER_CITIES[0]]
    else:
        # Default to Seattle if no cities specified
        cities_to_fetch = [WEATHER_CITIES[0]]
    
    fetched_at = datetime.utcnow().isoformat() + "Z"
    rows = []
    
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    # Determine which API to use
    # Archive API has 5-day delay, so use forecast API for recent data (< 6 days)
    # unless explicitly requested
    use_archive = False
    if use_archive_param == 'true':
        use_archive = True
    elif use_archive_param == 'false':
        use_archive = False
    else:  # 'auto'
        # Use archive for data older than 6 days
        use_archive = days > 6
    
    # Weather code descriptions (WMO Weather interpretation codes)
    weather_desc = {
        0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
        45: "Foggy", 48: "Depositing Rime Fog",
        51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
        61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
        71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
        80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
        85: "Slight Snow Showers", 86: "Heavy Snow Showers",
        95: "Thunderstorm", 96: "Thunderstorm with Hail", 99: "Thunderstorm with Heavy Hail"
    }
    
    for city in cities_to_fetch:
        try:
            params = {
                "latitude": city["lat"],
                "longitude": city["lon"],
                "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl",
                "timezone": "auto",
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d")
            }
            
            # Use archive API for historical data, forecast API for recent data
            if use_archive:
                api_url = "https://api.open-meteo.com/v1/archive"
            else:
                api_url = "https://api.open-meteo.com/v1/forecast"
            
            response = requests.get(api_url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            temps = hourly.get("temperature_2m", [])
            humidity = hourly.get("relative_humidity_2m", [])
            wind = hourly.get("wind_speed_10m", [])
            precip = hourly.get("precipitation", [])
            weather_codes = hourly.get("weather_code", [])
            pressure = hourly.get("pressure_msl", [])
            
            for i, time_str in enumerate(times):
                code = weather_codes[i] if i < len(weather_codes) else 0
                # Parse timestamp - handle both formats
                if "T" in time_str:
                    timestamp_str = time_str
                else:
                    timestamp_str = time_str + "T00:00:00Z"
                
                rows.append({
                    "city": city["name"],
                    "state": city.get("state", ""),
                    "timestamp": timestamp_str,
                    "temperature_c": round(temps[i], 1) if i < len(temps) and temps[i] is not None else None,
                    "humidity_percent": humidity[i] if i < len(humidity) and humidity[i] is not None else None,
                    "wind_speed_kmh": round(wind[i], 1) if i < len(wind) and wind[i] is not None else None,
                    "precipitation_mm": round(precip[i], 2) if i < len(precip) and precip[i] is not None else None,
                    "pressure_hpa": round(pressure[i], 1) if i < len(pressure) and pressure[i] is not None else None,
                    "weather_code": code,
                    "weather": weather_desc.get(code, "Unknown"),
                    "fetched_at": fetched_at
                })
        except Exception as e:
            logger.warning(f"Failed to fetch weather history for {city['name']}: {e}")
    
    # Sort by city, then timestamp
    rows.sort(key=lambda x: (x["city"], x["timestamp"]))
    
    return make_csv_response(rows)


# ============================================================================
# Weather Forecast (Open-Meteo) - Multi-day forecasts for multiple cities
# Recommended refresh: 3600 seconds (1 hour)
# ============================================================================

@demo_stream_bp.route('/weather/forecast', methods=['GET'])
@limiter.limit(WEATHER_RATE_LIMIT)
def get_weather_forecast():
    """
    Multi-day weather forecast for US cities. Updates every few hours.
    
    Query params:
        - cities: Comma-separated list of city names (default: all cities)
                  Example: cities=Seattle,New York,Los Angeles
        - days: Number of forecast days (default: 7, max: 16)
        - hourly: 'true' to get hourly forecast data (default: 'false' for daily)
    
    Use case:
        - Compare forecasts across multiple cities
        - Track upcoming weather patterns
        - Plan based on forecasted conditions
        - Use hourly=true for detailed hourly forecasts
    
    Recommended refresh: 3600 seconds (1 hour)
    """
    cities_param = request.args.get('cities', '').strip()
    days = min(16, max(1, int(request.args.get('days', 7))))
    hourly_mode = request.args.get('hourly', 'false').lower() == 'true'
    
    # Parse city filter
    if cities_param:
        city_names = [c.strip() for c in cities_param.split(',')]
        cities_to_fetch = [c for c in WEATHER_CITIES if c["name"] in city_names]
        if not cities_to_fetch:
            cities_to_fetch = WEATHER_CITIES
    else:
        cities_to_fetch = WEATHER_CITIES
    
    fetched_at = datetime.utcnow().isoformat() + "Z"
    rows = []
    
    for city in cities_to_fetch:
        try:
            if hourly_mode:
                # Hourly forecast
                params = {
                    "latitude": city["lat"],
                    "longitude": city["lon"],
                    "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl",
                    "forecast_days": days,
                    "timezone": "auto"
                }
                response = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=30)
                response.raise_for_status()
                data = response.json()
                
                hourly = data.get("hourly", {})
                times = hourly.get("time", [])
                temps = hourly.get("temperature_2m", [])
                humidity = hourly.get("relative_humidity_2m", [])
                wind = hourly.get("wind_speed_10m", [])
                precip = hourly.get("precipitation", [])
                weather_codes = hourly.get("weather_code", [])
                pressure = hourly.get("pressure_msl", [])
                
                weather_desc = {
                    0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
                    45: "Foggy", 48: "Depositing Rime Fog",
                    51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
                    61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
                    71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
                    80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
                    85: "Slight Snow Showers", 86: "Heavy Snow Showers",
                    95: "Thunderstorm", 96: "Thunderstorm with Hail", 99: "Thunderstorm with Heavy Hail"
                }
                
                for i, time_str in enumerate(times):
                    code = weather_codes[i] if i < len(weather_codes) else 0
                    rows.append({
                        "city": city["name"],
                        "state": city.get("state", ""),
                        "timestamp": time_str,
                        "temperature_c": round(temps[i], 1) if i < len(temps) and temps[i] is not None else None,
                        "humidity_percent": humidity[i] if i < len(humidity) and humidity[i] is not None else None,
                        "wind_speed_kmh": round(wind[i], 1) if i < len(wind) and wind[i] is not None else None,
                        "precipitation_mm": round(precip[i], 2) if i < len(precip) and precip[i] is not None else None,
                        "pressure_hpa": round(pressure[i], 1) if i < len(pressure) and pressure[i] is not None else None,
                        "weather_code": code,
                        "weather": weather_desc.get(code, "Unknown"),
                        "fetched_at": fetched_at
                    })
            else:
                # Daily forecast
                params = {
                    "latitude": city["lat"],
                    "longitude": city["lon"],
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
                    "forecast_days": days,
                    "timezone": "auto"
                }
                response = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=30)
                response.raise_for_status()
                data = response.json()
                
                daily = data.get("daily", {})
                times = daily.get("time", [])
                temp_max = daily.get("temperature_2m_max", [])
                temp_min = daily.get("temperature_2m_min", [])
                precip = daily.get("precipitation_sum", [])
                wind = daily.get("wind_speed_10m_max", [])
                weather_codes = daily.get("weather_code", [])
                
                weather_desc = {
                    0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
                    45: "Foggy", 48: "Depositing Rime Fog",
                    51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
                    61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
                    71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
                    80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
                    85: "Slight Snow Showers", 86: "Heavy Snow Showers",
                    95: "Thunderstorm", 96: "Thunderstorm with Hail", 99: "Thunderstorm with Heavy Hail"
                }
                
                for i, time_str in enumerate(times):
                    code = weather_codes[i] if i < len(weather_codes) else 0
                    rows.append({
                        "city": city["name"],
                        "state": city.get("state", ""),
                        "date": time_str,
                        "temperature_max_c": round(temp_max[i], 1) if i < len(temp_max) and temp_max[i] is not None else None,
                        "temperature_min_c": round(temp_min[i], 1) if i < len(temp_min) and temp_min[i] is not None else None,
                        "precipitation_mm": round(precip[i], 2) if i < len(precip) and precip[i] is not None else None,
                        "wind_speed_max_kmh": round(wind[i], 1) if i < len(wind) and wind[i] is not None else None,
                        "weather_code": code,
                        "weather": weather_desc.get(code, "Unknown"),
                        "fetched_at": fetched_at
                    })
        except Exception as e:
            logger.warning(f"Failed to fetch forecast for {city['name']}: {e}")
    
    return make_csv_response(rows)


# ============================================================================
# Today's Weather Comparison - Current weather across multiple cities
# Recommended refresh: 300 seconds (5 minutes)
# ============================================================================

@demo_stream_bp.route('/weather/today', methods=['GET'])
@limiter.limit(WEATHER_RATE_LIMIT)
def get_weather_today():
    """
    Today's current weather for multiple US cities - perfect for comparison.
    
    Query params:
        - cities: Comma-separated list of city names (default: all cities)
                  Example: cities=Seattle,New York,Los Angeles,Miami
        - limit: Maximum number of cities to return (default: 20, max: 50)
    
    Use case:
        - Compare current weather conditions across US cities
        - Visualize temperature, humidity, wind patterns geographically
        - Great for maps, bar charts, and comparison visualizations
        - Perfect for "weather dashboard" style analysis
    
    Recommended refresh: 300 seconds (5 minutes)
    """
    cities_param = request.args.get('cities', '').strip()
    limit = min(50, max(1, int(request.args.get('limit', 20))))
    
    # Parse city filter
    if cities_param:
        city_names = [c.strip() for c in cities_param.split(',')]
        cities_to_fetch = [c for c in WEATHER_CITIES if c["name"] in city_names][:limit]
        if not cities_to_fetch:
            cities_to_fetch = WEATHER_CITIES[:limit]
    else:
        cities_to_fetch = WEATHER_CITIES[:limit]
    
    fetched_at = datetime.utcnow().isoformat() + "Z"
    rows = []
    
    for city in cities_to_fetch:
        try:
            params = {
                "latitude": city["lat"],
                "longitude": city["lon"],
                "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,pressure_msl,cloud_cover,weather_code",
                "timezone": "auto"
            }
            response = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            current = data.get("current", {})
            
            weather_desc = {
                0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
                45: "Foggy", 48: "Depositing Rime Fog",
                51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
                61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
                71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
                80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
                85: "Slight Snow Showers", 86: "Heavy Snow Showers",
                95: "Thunderstorm", 96: "Thunderstorm with Hail", 99: "Thunderstorm with Heavy Hail"
            }
            
            weather_code = current.get("weather_code", 0)
            
            rows.append({
                "city": city["name"],
                "state": city.get("state", ""),
                "latitude": city["lat"],
                "longitude": city["lon"],
                "temperature_c": round(current.get("temperature_2m"), 1) if current.get("temperature_2m") is not None else None,
                "temperature_f": round(current.get("temperature_2m") * 9/5 + 32, 1) if current.get("temperature_2m") is not None else None,
                "humidity_percent": current.get("relative_humidity_2m"),
                "wind_speed_kmh": round(current.get("wind_speed_10m"), 1) if current.get("wind_speed_10m") is not None else None,
                "wind_direction_deg": current.get("wind_direction_10m"),
                "precipitation_mm": round(current.get("precipitation"), 2) if current.get("precipitation") is not None else None,
                "pressure_hpa": round(current.get("pressure_msl"), 1) if current.get("pressure_msl") is not None else None,
                "cloud_cover_percent": current.get("cloud_cover"),
                "weather_code": weather_code,
                "weather": weather_desc.get(weather_code, "Unknown"),
                "fetched_at": fetched_at
            })
        except Exception as e:
            logger.warning(f"Failed to fetch weather for {city['name']}: {e}")
    
    return make_csv_response(rows)


# ============================================================================
# yfinance - Stock/Financial Data via Yahoo Finance
# Three pre-baked APIs: history (daily), recent (intraday), financials (metrics)
# ============================================================================

DEFAULT_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"]

# S&P 100 Companies (as of 2024)
SP100_SYMBOLS = [
    # Technology
    "AAPL", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "AVGO", "ORCL", "CRM", "CSCO",
    "ACN", "ADBE", "AMD", "INTC", "IBM", "QCOM", "TXN",
    # Consumer/Retail
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "COST",
    # Financial Services
    "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "BLK", "SPGI", "AXP", "C", "BK",
    # Healthcare
    "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN", 
    "GILD", "MDT", "CVS",
    # Energy
    "XOM", "CVX", "COP", "SLB",
    # Industrials
    "CAT", "GE", "HON", "UNP", "UPS", "RTX", "BA", "LMT", "DE", "MMM", "EMR",
    # Consumer Staples
    "PG", "KO", "PEP", "WMT", "PM", "MO", "CL", "MDLZ",
    # Communications
    "DIS", "CMCSA", "NFLX", "T", "VZ", "TMUS",
    # Utilities & Real Estate
    "NEE", "DUK", "SO",
    # Materials
    "LIN", "DOW",
    # Other Major Companies
    "BRK-B", "PYPL", "NOW", "INTU", "AMAT", "ADI", "MU", "LRCX", "KLAC",
    "SCHW", "CB", "PNC", "USB", "TFC",
    "ISRG", "VRTX", "REGN", "ZTS", "SYK", "ELV",
    "F", "GM",
    "ADP", "FIS", "ITW", "GD", "NOC",
    "EXC", "AEP", "D", "SRE", "PEG"
]


# Helper functions for yfinance endpoints
def _yf_is_valid(val):
    """Check if value is valid (not NaN/None)"""
    try:
        return val is not None and not (isinstance(val, float) and math.isnan(val))
    except:
        return False


def _yf_format_timestamp(date_obj):
    """Convert pandas Timestamp or datetime to string"""
    try:
        if hasattr(date_obj, 'tz_convert'):
            date_utc = date_obj.tz_convert('UTC')
        elif hasattr(date_obj, 'tz_localize') and date_obj.tz is not None:
            date_utc = date_obj.tz_convert('UTC')
        else:
            date_utc = date_obj
        
        if hasattr(date_utc, 'to_pydatetime'):
            date_utc = date_utc.to_pydatetime()
        elif hasattr(date_utc, 'timestamp'):
            date_utc = datetime.fromtimestamp(date_utc.timestamp())
        
        if isinstance(date_utc, datetime):
            return date_utc.strftime("%Y-%m-%d %H:%M:%S")
        else:
            return str(date_utc)
    except:
        return str(date_obj)


@demo_stream_bp.route('/yfinance/history', methods=['GET'])
@limiter.limit(YFINANCE_RATE_LIMIT)
def get_yfinance_history():
    """
    6-month daily stock price history via yfinance.
    
    Returns daily OHLCV data for the last 6 months.
    
    Query params:
        - symbols: comma-separated stock symbols (default: AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA)
    
    Example:
        /api/demo-stream/yfinance/history?symbols=AAPL,MSFT,GOOGL
    
    Recommended refresh: 3600 seconds (1 hour)
    """
    symbols_param = request.args.get('symbols', ','.join(DEFAULT_SYMBOLS))
    symbols = [s.strip().upper() for s in symbols_param.split(',') if s.strip()][:10]
    
    now = datetime.utcnow()
    start_date = now - timedelta(days=180)  # 6 months
    
    fetched_at = now.isoformat() + "Z"
    rows = []
    
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=now.strftime("%Y-%m-%d"))
            
            for date, row in hist.iterrows():
                try:
                    date_str = date.strftime("%Y-%m-%d") if hasattr(date, 'strftime') else str(date)
                except:
                    date_str = str(date)
                
                rows.append({
                    "symbol": symbol,
                    "date": date_str,
                    "open": round(row["Open"], 2) if _yf_is_valid(row["Open"]) else None,
                    "high": round(row["High"], 2) if _yf_is_valid(row["High"]) else None,
                    "low": round(row["Low"], 2) if _yf_is_valid(row["Low"]) else None,
                    "close": round(row["Close"], 2) if _yf_is_valid(row["Close"]) else None,
                    "volume": int(row["Volume"]) if _yf_is_valid(row["Volume"]) else None,
                    "fetched_at": fetched_at
                })
                    
        except Exception as e:
            logger.warning(f"Failed to fetch history for {symbol}: {e}")
    
    # Sort by symbol, then date
    rows.sort(key=lambda x: (x["symbol"], x["date"]))
    
    return make_csv_response(rows)


@demo_stream_bp.route('/yfinance/recent', methods=['GET'])
@limiter.limit(YFINANCE_RATE_LIMIT)
def get_yfinance_recent():
    """
    Recent intraday stock prices (15-minute intervals) via yfinance.
    
    Returns 15-minute interval data for the last 5 trading days.
    yfinance typically provides intraday data for the last 5-7 days only.
    
    Query params:
        - symbols: comma-separated stock symbols (default: AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA)
    
    Example:
        /api/demo-stream/yfinance/recent?symbols=AAPL,MSFT,GOOGL
    
    Recommended refresh: 300 seconds (5 minutes) during market hours
    """
    symbols_param = request.args.get('symbols', ','.join(DEFAULT_SYMBOLS))
    symbols = [s.strip().upper() for s in symbols_param.split(',') if s.strip()][:10]
    
    now = datetime.utcnow()
    fetched_at = now.isoformat() + "Z"
    rows = []
    
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            
            # Get 5 days of 15-minute interval data
            hist = ticker.history(interval='15m', period='5d')
            
            if not hist.empty:
                for date, row in hist.iterrows():
                    timestamp_str = _yf_format_timestamp(date)
                    
                    rows.append({
                        "symbol": symbol,
                        "timestamp": timestamp_str,
                        "date": timestamp_str.split()[0] if ' ' in timestamp_str else str(date),
                        "open": round(row["Open"], 2) if _yf_is_valid(row["Open"]) else None,
                        "high": round(row["High"], 2) if _yf_is_valid(row["High"]) else None,
                        "low": round(row["Low"], 2) if _yf_is_valid(row["Low"]) else None,
                        "close": round(row["Close"], 2) if _yf_is_valid(row["Close"]) else None,
                        "volume": int(row["Volume"]) if _yf_is_valid(row["Volume"]) else None,
                        "fetched_at": fetched_at
                    })
                    
        except Exception as e:
            logger.warning(f"Failed to fetch recent data for {symbol}: {e}")
    
    # Sort by symbol, then timestamp
    rows.sort(key=lambda x: (x["symbol"], x["timestamp"]))
    
    return make_csv_response(rows)


@demo_stream_bp.route('/yfinance/financials', methods=['GET'])
@limiter.limit(YFINANCE_RATE_LIMIT)
def get_yfinance_financials():
    """
    Key financial metrics snapshot via yfinance for S&P 100 companies.
    
    Returns current financial data for each stock including market cap,
    P/E ratio, EPS, dividend yield, 52-week range, and more.
    
    Query params:
        - symbols: comma-separated stock symbols (default: all S&P 100 companies)
    
    Example:
        /api/demo-stream/yfinance/financials
        /api/demo-stream/yfinance/financials?symbols=AAPL,MSFT,GOOGL,AMZN
    
    Recommended refresh: 3600 seconds (1 hour)
    """
    symbols_param = request.args.get('symbols')
    if symbols_param:
        symbols = [s.strip().upper() for s in symbols_param.split(',') if s.strip()]
    else:
        symbols = SP100_SYMBOLS
    
    now = datetime.utcnow()
    fetched_at = now.isoformat() + "Z"
    rows = []
    
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            # Extract key financial metrics
            rows.append({
                "symbol": symbol,
                "name": info.get('shortName') or info.get('longName') or symbol,
                "sector": info.get('sector') or 'N/A',
                "industry": info.get('industry') or 'N/A',
                "current_price": round(info.get('currentPrice') or info.get('regularMarketPrice') or 0, 2),
                "previous_close": round(info.get('previousClose') or 0, 2),
                "market_cap": info.get('marketCap') or 0,
                "pe_ratio": round(info.get('trailingPE') or 0, 2) if info.get('trailingPE') else None,
                "forward_pe": round(info.get('forwardPE') or 0, 2) if info.get('forwardPE') else None,
                "eps": round(info.get('trailingEps') or 0, 2) if info.get('trailingEps') else None,
                "dividend_yield": round((info.get('dividendYield') or 0) * 100, 2) if info.get('dividendYield') else 0,
                "week_52_high": round(info.get('fiftyTwoWeekHigh') or 0, 2),
                "week_52_low": round(info.get('fiftyTwoWeekLow') or 0, 2),
                "avg_volume": info.get('averageVolume') or 0,
                "beta": round(info.get('beta') or 0, 2) if info.get('beta') else None,
                "profit_margin": round((info.get('profitMargins') or 0) * 100, 2) if info.get('profitMargins') else None,
                "revenue": info.get('totalRevenue') or 0,
                "fetched_at": fetched_at
            })
                    
        except Exception as e:
            logger.warning(f"Failed to fetch financials for {symbol}: {e}")
    
    # Sort by symbol
    rows.sort(key=lambda x: x["symbol"])
    
    return make_csv_response(rows)


# ============================================================================
# Mock Live Sales Feed - Accumulating dataset with rolling 1000 records
# Similar to ISS tracking - data accumulates in memory
# Recommended refresh: 1-5 seconds
# ============================================================================

# Thread-safe storage for sales transaction history
_sales_lock = threading.Lock()
_sales_history: deque = deque(maxlen=1000)  # Keep last 1000 transactions
_sales_last_update: datetime | None = None

# Products with realistic pricing and popularity
_SALES_PRODUCTS = [
    {"name": "Wireless Headphones", "category": "Electronics", "base_price": 79.99, "popularity": 0.15},
    {"name": "Smart Watch", "category": "Electronics", "base_price": 199.99, "popularity": 0.10},
    {"name": "Running Shoes", "category": "Sports", "base_price": 129.99, "popularity": 0.12},
    {"name": "Yoga Mat", "category": "Sports", "base_price": 34.99, "popularity": 0.08},
    {"name": "Coffee Maker", "category": "Home", "base_price": 89.99, "popularity": 0.09},
    {"name": "Desk Lamp", "category": "Home", "base_price": 45.99, "popularity": 0.07},
    {"name": "Backpack", "category": "Accessories", "base_price": 59.99, "popularity": 0.11},
    {"name": "Water Bottle", "category": "Accessories", "base_price": 24.99, "popularity": 0.13},
    {"name": "Bluetooth Speaker", "category": "Electronics", "base_price": 49.99, "popularity": 0.08},
    {"name": "Fitness Tracker", "category": "Electronics", "base_price": 69.99, "popularity": 0.07},
]

_SALES_REGIONS = ["North America", "Europe", "Asia Pacific", "Latin America"]
_SALES_REGION_WEIGHTS = [0.45, 0.30, 0.18, 0.07]

_SALES_CHANNELS = ["Web", "Mobile App", "In-Store", "Partner"]
_SALES_CHANNEL_WEIGHTS = [0.40, 0.35, 0.15, 0.10]


def _generate_sale_transaction(timestamp: datetime) -> dict[str, Any]:
    """Generate a single sale transaction"""
    product = random.choices(_SALES_PRODUCTS, weights=[p["popularity"] for p in _SALES_PRODUCTS])[0]
    region = random.choices(_SALES_REGIONS, weights=_SALES_REGION_WEIGHTS)[0]
    channel = random.choices(_SALES_CHANNELS, weights=_SALES_CHANNEL_WEIGHTS)[0]
    
    quantity = random.choices([1, 2, 3, 4, 5], weights=[0.5, 0.25, 0.15, 0.07, 0.03])[0]
    discount = random.choices([0, 5, 10, 15, 20], weights=[0.6, 0.15, 0.12, 0.08, 0.05])[0]
    
    unit_price = round(product["base_price"] * (1 - discount / 100), 2)
    total = round(unit_price * quantity, 2)
    
    return {
        "transaction_id": f"TX{int(timestamp.timestamp() * 1000) % 100000000:08d}",
        "timestamp": timestamp.isoformat() + "Z",
        "product": product["name"],
        "category": product["category"],
        "quantity": quantity,
        "unit_price": unit_price,
        "discount_pct": discount,
        "total": total,
        "region": region,
        "channel": channel,
    }


@demo_stream_bp.route('/live-sales', methods=['GET'])
@limiter.limit(MOCK_RATE_LIMIT)
def get_live_sales():
    """
    Simulated live sales feed with accumulating transaction history.
    Data accumulates in memory and maintains a rolling record of the last 1000 transactions.
    Each refresh may add new transactions and returns the complete accumulated dataset.
    
    Query params:
        - limit: Maximum number of records to return (default: 1000, max: 1000)
    
    Recommended refresh: 1-5 seconds
    """
    global _sales_last_update
    
    now = datetime.utcnow()
    limit = min(1000, max(1, int(request.args.get('limit', 1000))))
    
    # Generate new transactions if enough time has passed (at least 1 second)
    with _sales_lock:
        should_update = _sales_last_update is None or (now - _sales_last_update).total_seconds() >= 1
        
        if should_update:
            # If no data exists yet, generate initial batch of transactions
            if len(_sales_history) == 0:
                # Generate 5-10 initial transactions
                num_initial = random.randint(5, 10)
                for _ in range(num_initial):
                    tx_time = now - timedelta(seconds=random.randint(0, 60))
                    transaction = _generate_sale_transaction(tx_time)
                    transaction["fetched_at"] = now.isoformat() + "Z"
                    _sales_history.append(transaction)
            else:
                # Generate 1-3 new transactions per update
                num_new_transactions = random.randint(1, 3)
                for _ in range(num_new_transactions):
                    # Spread transactions over the last second
                    tx_time = now - timedelta(milliseconds=random.randint(0, 1000))
                    transaction = _generate_sale_transaction(tx_time)
                    transaction["fetched_at"] = now.isoformat() + "Z"
                    _sales_history.append(transaction)
            
            _sales_last_update = now
        
        # Return all accumulated records (up to limit)
        rows = list(_sales_history)[-limit:]
    
    # Sort by timestamp descending (most recent first)
    rows.sort(key=lambda x: x["timestamp"], reverse=True)
    
    return make_csv_response(rows)


# ============================================================================
# API Info Endpoint
# ============================================================================

@demo_stream_bp.route('/info', methods=['GET'])
def get_info():
    """List all available demo data endpoints with their parameters"""
    return jsonify({
        "name": "Demo Data REST APIs",
        "description": "Each endpoint returns CSV text with complete datasets that change over time. "
                       "Import URL in frontend, set auto-refresh to watch data evolve.",
        "design_philosophy": [
            "Each endpoint returns a COMPLETE dataset (not just one row)",
            "Datasets are meaningful for analysis and visualization", 
            "When refreshed, new data may appear (accumulating) or values may update",
            "Use date parameters to track data from a specific point in time"
        ],
        "demo_examples": [
            # Stock Market Data - History, Intraday, and Financials
            {
                "id": "stocks-history",
                "url": "/api/demo-stream/yfinance/history?symbols=AAPL,MSFT,GOOGL,AMZN,META,NVDA",
                "name": "📈 Yahoo Finance: 6-Month Stock Price History - Tech Companies (updates daily)",
                "refresh_seconds": 86400,
            },
            {
                "id": "stocks-intraday",
                "url": "/api/demo-stream/yfinance/recent?symbols=AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA",
                "name": "📈 Yahoo Finance: Recent Intraday Stock Prices - Tech Companies (updates every 15 min)",
                "refresh_seconds": 900,
            },
            {
                "id": "stocks-financials",
                "url": "/api/demo-stream/yfinance/financials",
                "name": "📈 Yahoo Finance: S&P 100 Key Financial Metrics (updates daily)",
                "refresh_seconds": 86400,
            },
            # ISS Tracking Variations
            {
                "id": "iss-trajectory-recent",
                "url": "/api/demo-stream/iss",
                "name": "🛰️ Open Notify: International Space Station Real-time Positions (updates every 30 sec)",
                "refresh_seconds": 30,
                "reset_url": "/api/demo-stream/iss/reset",
            },
            
            # Earthquake Data Variations
            {
                "id": "earthquakes-significant-week",
                "url": "/api/demo-stream/earthquakes?timeframe=week&min_magnitude=4",
                "name": "🌍 USGS: Significant Earthquakes Worldwide - Last Week (updates every minute)",
                "refresh_seconds": 60,
            },

            # Weather Data Variations
            {
                "id": "weather-today-all-cities",
                "url": "/api/demo-stream/weather/today",
                "name": "🌤️ Open Meteo: Today's Weather - 20 Major US Cities (updates daily)",
                "refresh_seconds": 86400,
            },
            {
                "id": "weather-forecast-hourly",
                "url": "/api/demo-stream/weather/forecast?days=3&hourly=true",
                "name": "🌤️ Open Meteo: 3-Day Hourly Weather Forecast - US Cities (updates hourly)",
                "refresh_seconds": 3600,
            },
            
            # Live Sales & E-commerce Variations
            {
                "id": "live-sales-feed",
                "url": "/api/demo-stream/live-sales",
                "name": "💰 Simulated: Live E-commerce Sales Feed (updates every 5 seconds)",
                "refresh_seconds": 5,
            }
        ],
        "usage": "Click any example to load it, or enter a custom URL. Set auto-refresh to watch data change over time."
    })

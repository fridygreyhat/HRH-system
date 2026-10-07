import math
from typing import Optional


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def location_status(uses_facility_geofence: bool, facility, lat: Optional[float], lon: Optional[float]) -> str:
    """Classify a GPS sample for human review. Never used to auto-reject work.

    Facility-based cadres are compared with the facility's configured geofence. Community workers (CHW)
    are never held to a facility boundary; their samples are shown to the supervisor for review.
    """
    if lat is None or lon is None:
        return "NO_GPS"
    if not uses_facility_geofence:
        return "COMMUNITY_REVIEW"
    if facility is None or None in (facility.geofence_lat, facility.geofence_lon, facility.geofence_radius_meters):
        return "NO_GEOFENCE"
    d = distance_meters(float(lat), float(lon), float(facility.geofence_lat), float(facility.geofence_lon))
    return "WITHIN_GEOFENCE" if d <= facility.geofence_radius_meters else "OUTSIDE_GEOFENCE"


LOCATION_EXCEPTIONS = {"NO_GPS", "OUTSIDE_GEOFENCE", "NO_GEOFENCE"}

"""Explicit Region × Cadre scope for the new financial workflow."""
from sqlalchemy import and_, false, select, true

from ..models import Cluster, StaffAssignment
from ..core.roles import RPM


def regions_for(current) -> set[int]:
    regions = set(current.scope_values("region_id"))
    clusters = current.scope_values("cluster_id")
    if clusters and current.db is not None:
        regions |= {r[0] for r in current.db.query(Cluster.region_id).filter(Cluster.id.in_(clusters))}
    return regions


def may_manage(current, region_id: int, cadre_id: int, role=None) -> bool:
    # RPM operational authority is regional; finance and technical authority
    # remain explicitly cadre-scoped, even when one person holds both roles.
    return current.unrestricted or (
        region_id in regions_for(current) and (role == RPM or cadre_id in current.review_cadres)
    )


def record_condition(current, assignment_column, cadre_column, role=None):
    if current.unrestricted:
        return true()
    regions = regions_for(current)
    if not regions or (role != RPM and not current.review_cadres):
        return false()
    regional = assignment_column.in_(select(StaffAssignment.id).where(StaffAssignment.region_id.in_(regions)))
    return regional if role == RPM else and_(regional, cadre_column.in_(current.review_cadres))

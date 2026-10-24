"""Explicit Region × Cadre scope for the new financial workflow."""
from sqlalchemy import and_, false, select, true

from ..models import Cluster, StaffAssignment


def regions_for(current) -> set[int]:
    regions = set(current.scope_values("region_id"))
    clusters = current.scope_values("cluster_id")
    if clusters and current.db is not None:
        regions |= {r[0] for r in current.db.query(Cluster.region_id).filter(Cluster.id.in_(clusters))}
    return regions


def may_manage(current, region_id: int, cadre_id: int) -> bool:
    return current.unrestricted or (region_id in regions_for(current) and cadre_id in current.review_cadres)


def record_condition(current, assignment_column, cadre_column):
    if current.unrestricted:
        return true()
    regions = regions_for(current)
    if not regions or not current.review_cadres:
        return false()
    return and_(
        assignment_column.in_(select(StaffAssignment.id).where(StaffAssignment.region_id.in_(regions))),
        cadre_column.in_(current.review_cadres),
    )

"""Regional payment authority for new-record CSO payroll, not a migration of legacy claims."""
from fastapi import HTTPException

from ..models import CSORegionAssignment, Organization


def require_assignment(db, organization_id, region_id, *, lock=False):
    org = (db.query(Organization).filter_by(id=organization_id).populate_existing().with_for_update().first()
           if lock else db.get(Organization, organization_id))
    if not org or org.type != "CSO" or not org.is_active:
        raise HTTPException(422, "Select an active CSO organization")
    query = db.query(CSORegionAssignment).filter_by(
        organization_id=organization_id, region_id=region_id,
    )
    if lock:
        query = query.with_for_update()
    assignment = query.first()
    if not assignment or not assignment.is_active:
        raise HTTPException(422, "The provider's CSO is not authorized for this region. Ask an administrator to configure its CSO–region assignment.")
    return assignment

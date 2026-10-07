"""Organizations and geography: payors/CSOs, region → district → ward → facility, clusters, community areas."""
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Integer, Numeric, String

from .base import Base, created_at

ORG_TYPES = ("FHI360", "CSO", "PAYOR", "PARTNER")


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (CheckConstraint(f"type IN {ORG_TYPES}", name="type"),)
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    code = Column(String(50), unique=True)
    type = Column(String(20), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = created_at()


class Region(Base):
    __tablename__ = "regions"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    created_at = created_at()


class Cluster(Base):
    __tablename__ = "clusters"
    id = Column(Integer, primary_key=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    created_at = created_at()


class District(Base):
    __tablename__ = "districts"
    id = Column(Integer, primary_key=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    created_at = created_at()


class Ward(Base):
    __tablename__ = "wards"
    id = Column(Integer, primary_key=True)
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    created_at = created_at()


class Facility(Base):
    __tablename__ = "facilities"
    id = Column(Integer, primary_key=True)
    ward_id = Column(Integer, ForeignKey("wards.id"), nullable=False, index=True)
    cluster_id = Column(Integer, ForeignKey("clusters.id"), index=True)
    name = Column(String(255), nullable=False)
    facility_type = Column(String(50))  # e.g. PUBLIC, PNP
    # Geofence is configuration, never hard-coded; NULL = no geofence configured.
    geofence_lat = Column(Numeric(10, 8))
    geofence_lon = Column(Numeric(11, 8))
    geofence_radius_meters = Column(Integer)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = created_at()


class CommunityArea(Base):
    __tablename__ = "community_areas"
    id = Column(Integer, primary_key=True)
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=False, index=True)
    ward_id = Column(Integer, ForeignKey("wards.id"))
    name = Column(String(255), nullable=False)
    geofence_lat = Column(Numeric(10, 8))
    geofence_lon = Column(Numeric(11, 8))
    geofence_radius_meters = Column(Integer)
    created_at = created_at()


class Section(Base):
    """Facility sections from the supplied forms: CTC, OPD, RCH, IPD, Non-Government Provider."""

    __tablename__ = "sections"
    code = Column(String(20), primary_key=True)
    name = Column(String(100), nullable=False)

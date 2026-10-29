"""Strict, credential-free configuration transfer format."""
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class FacilityRef(Strict):
    name: str = Field(min_length=1, max_length=255)
    ward: str = Field(min_length=1, max_length=255)
    district: str = Field(min_length=1, max_length=255)
    region: str = Field(min_length=1, max_length=255)


class OrganizationData(Strict):
    name: str = Field(min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=50)
    type: Literal["FHI360", "CSO", "PAYOR", "PARTNER"]


class FundingData(Strict):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)


class FacilityData(FacilityRef):
    facility_type: str | None = Field(default=None, max_length=50)
    geofence_lat: Decimal | None = Field(default=None, ge=-90, le=90, max_digits=10, decimal_places=8)
    geofence_lon: Decimal | None = Field(default=None, ge=-180, le=180, max_digits=11, decimal_places=8)
    geofence_radius_meters: int | None = Field(default=None, gt=0, le=100000)

    @model_validator(mode="after")
    def geofence(self):
        values = [self.geofence_lat, self.geofence_lon, self.geofence_radius_meters]
        if any(v is not None for v in values) and not all(v is not None for v in values):
            raise ValueError("A facility geofence requires latitude, longitude and radius")
        return self


class PeriodData(Strict):
    region: str | None = Field(default=None, max_length=255)
    start_date: date
    end_date: date
    period_label: str | None = Field(default=None, max_length=100)
    status: Literal["OPEN", "CLOSED"]

    @model_validator(mode="after")
    def dates(self):
        if not 2000 <= self.start_date.year <= 2100 or not 2000 <= self.end_date.year <= 2100:
            raise ValueError("Period years must be 2000–2100")
        if not 0 <= (self.end_date - self.start_date).days <= 365:
            raise ValueError("Period must cover 1–366 days")
        return self


class ScopeData(Strict):
    region: str | None = Field(default=None, max_length=255)
    organization: str | None = Field(default=None, max_length=255)
    facility: FacilityRef | None = None

    @model_validator(mode="after")
    def nonempty(self):
        if not any((self.region, self.organization, self.facility)):
            raise ValueError("An empty scope is not transferable")
        return self


class AssignmentData(Strict):
    region: str = Field(min_length=1, max_length=255)
    district: str | None = Field(default=None, max_length=255)
    ward: str | None = Field(default=None, max_length=255)
    facility: FacilityRef | None = None
    organization: str | None = Field(default=None, max_length=255)
    section: str | None = Field(default=None, max_length=20)
    start_date: date
    end_date: date | None = None
    is_primary: bool = True

    @model_validator(mode="after")
    def dates(self):
        if not 2000 <= self.start_date.year <= 2100 or (
            self.end_date and (self.end_date < self.start_date or self.end_date.year > 2100)
        ):
            raise ValueError("Invalid assignment dates")
        if self.facility and self.facility.region != self.region:
            raise ValueError("Facility and assignment region must match")
        return self


class StaffData(Strict):
    cadre: Literal["CHW", "HCP", "DATA_CLERK"]
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    occupation: str | None = Field(default=None, max_length=100)
    occupation_other: str | None = Field(default=None, max_length=100)
    employment_start_date: date | None = None
    employment_end_date: date | None = None
    assignments: list[AssignmentData] = Field(max_length=100)

    @model_validator(mode="after")
    def placements(self):
        for i, a in enumerate(self.assignments):
            for b in self.assignments[i + 1:]:
                if max(a.start_date, b.start_date) <= min(a.end_date or date.max, b.end_date or date.max):
                    raise ValueError("Transferred staff assignments overlap")
        return self


TRANSFER_ROLES = {
    "PROVIDER", "SUPERVISOR", "FACILITY_IN_CHARGE", "TECHNICAL_OFFICER", "RPM",
    "REGIONAL_FINANCE", "FHI360_FINANCE", "CSO_FINANCE", "COMMUNITY_VERIFIER", "OVERSIGHT",
}


class UserData(Strict):
    username: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=255)
    phone: str = Field(pattern=r"^\+255[67]\d{8}$")
    roles: list[str] = Field(min_length=1, max_length=15)
    review_cadres: list[Literal["CHW", "HCP", "DATA_CLERK"]] = Field(max_length=3)
    scopes: list[ScopeData] = Field(max_length=100)
    staff: StaffData | None = None

    @model_validator(mode="after")
    def permissions(self):
        if not set(self.roles) <= TRANSFER_ROLES or len(set(self.roles)) != len(self.roles):
            raise ValueError("Only operational roles may be transferred; administrator roles are excluded")
        if ("PROVIDER" in self.roles) != (self.staff is not None):
            raise ValueError("Provider accounts require their linked staff setup")
        return self


class RateField(Strict):
    key: str = Field(min_length=1, max_length=100)
    label_en: str = Field(min_length=1, max_length=255)
    label_sw: str = Field(min_length=1, max_length=255)
    field_type: Literal["INTEGER", "DECIMAL", "BOOLEAN"]
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=100000)


class RateData(Strict):
    key: str = Field(min_length=1, max_length=80)
    source_key: str | None = Field(default=None, max_length=80)
    label_en: str = Field(min_length=1, max_length=255)
    label_sw: str = Field(min_length=1, max_length=255)
    cadre: Literal["CHW", "HCP", "DATA_CLERK"]
    region: str = Field(min_length=1, max_length=255)
    item_type: Literal["SERVICES"]
    form_mode: Literal["CASCADE", "SINGLE"]
    field_definitions: list[dict] = Field(max_length=100)
    hours_input: bool
    rate_value: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: Literal["TZS"]
    unit_type: Literal["PER_DAY"]
    billable_field: None = None
    effective_start_date: date

    @field_validator("field_definitions")
    @classmethod
    def fields(cls, values):
        for value in values:
            RateField.model_validate(value)
        keys = [v["key"] for v in values]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate activity field keys")
        return values


DATA_TYPES = {
    "organization": OrganizationData, "funding_source": FundingData,
    "facility": FacilityData, "pay_period": PeriodData, "user_setup": UserData,
    "service_rate": RateData,
}


class TransferRecord(Strict):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["organization", "funding_source", "facility", "pay_period", "user_setup", "service_rate"]
    label: str = Field(min_length=1, max_length=255)
    data: dict

    @model_validator(mode="after")
    def validate_data(self):
        self.data = DATA_TYPES[self.kind].model_validate(self.data).model_dump(mode="json")
        return self


class TransferDocument(Strict):
    version: Literal[1]
    records: list[TransferRecord] = Field(max_length=2000)
    warnings: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def bounded(self):
        ids = [r.id for r in self.records]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate transfer record IDs")
        identities = [(r.kind, repr(sorted(r.data.items()))) for r in self.records]
        if len(set(identities)) != len(identities):
            raise ValueError("Duplicate transfer records")
        if len(self.model_dump_json().encode()) > 1024 * 1024:
            raise ValueError("Setup document exceeds 1 MiB")
        return self

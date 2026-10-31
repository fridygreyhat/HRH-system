-- HRH application schema generated from this repository's Alembic migrations.
-- Source: fresh disposable PostgreSQL database upgraded to Alembic head.
-- This is NOT a Production database backup and contains NO application table data.
-- It defines the application tables but includes no user, work-log, approval,
-- payment, or seed/configuration rows.
-- Use the repository's approved migration/initialization workflow to rebuild a database.

--
-- PostgreSQL database dump
--

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: hrh_prevent_modification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hrh_prevent_modification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
        END;
        $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_rates (
    id integer NOT NULL,
    key character varying(80) NOT NULL,
    source_key character varying(80),
    label_en character varying(255) NOT NULL,
    label_sw character varying(255) NOT NULL,
    cadre_id integer NOT NULL,
    region_id integer NOT NULL,
    item_type character varying(20) NOT NULL,
    form_mode character varying(20) NOT NULL,
    field_definitions jsonb NOT NULL,
    hours_input boolean NOT NULL,
    rate_value numeric(15,2) NOT NULL,
    currency character varying(10) NOT NULL,
    unit_type character varying(20) NOT NULL,
    billable_field character varying(80),
    is_active boolean NOT NULL,
    effective_start_date date NOT NULL,
    supersedes_id integer,
    created_by integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_activity_rates_form_mode CHECK (((form_mode)::text = ANY ((ARRAY['CASCADE'::character varying, 'SINGLE'::character varying])::text[]))),
    CONSTRAINT ck_activity_rates_item_type CHECK (((item_type)::text = ANY ((ARRAY['SERVICES'::character varying, 'PAYROLL'::character varying])::text[]))),
    CONSTRAINT ck_activity_rates_rate CHECK ((rate_value >= (0)::numeric)),
    CONSTRAINT ck_activity_rates_unit_type CHECK (((unit_type)::text = ANY ((ARRAY['PER_UNIT'::character varying, 'PER_HOUR'::character varying, 'PER_DAY'::character varying])::text[])))
);


--
-- Name: activity_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_rates_id_seq OWNED BY public.activity_rates.id;


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id bigint NOT NULL,
    actor_id integer,
    actor_roles character varying(255),
    entity_type character varying(50) NOT NULL,
    entity_id character varying(50),
    action character varying(50) NOT NULL,
    before jsonb,
    after jsonb,
    reason text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_events_id_seq OWNED BY public.audit_events.id;


--
-- Name: backdate_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backdate_access (
    id integer NOT NULL,
    staff_id integer NOT NULL,
    assignment_id integer NOT NULL,
    entry_date date NOT NULL,
    granted_by integer NOT NULL,
    reason character varying(1000) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: backdate_access_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backdate_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backdate_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backdate_access_id_seq OWNED BY public.backdate_access.id;


--
-- Name: budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_lines (
    id integer NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    source character varying(20) NOT NULL,
    organization_id integer NOT NULL,
    category_id integer NOT NULL,
    period_id integer NOT NULL,
    region_id integer,
    allocated_amount numeric(15,2) NOT NULL,
    committed_amount numeric(15,2) NOT NULL,
    spent_amount numeric(15,2) NOT NULL,
    currency character varying(10) NOT NULL,
    sync_status character varying(20) NOT NULL,
    external_ref character varying(255),
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    estimated_amount numeric(15,2),
    CONSTRAINT ck_budget_lines_estimate_within_cap CHECK (((estimated_amount IS NULL) OR ((estimated_amount >= (0)::numeric) AND (estimated_amount <= allocated_amount)))),
    CONSTRAINT ck_budget_lines_non_negative CHECK (((committed_amount >= (0)::numeric) AND (spent_amount >= (0)::numeric))),
    CONSTRAINT ck_budget_lines_source CHECK (((source)::text = ANY ((ARRAY['FHI360_TRACKER'::character varying, 'CSO'::character varying])::text[]))),
    CONSTRAINT ck_budget_lines_sync_status CHECK (((sync_status)::text = ANY ((ARRAY['NOT_APPLICABLE'::character varying, 'UNSYNCED'::character varying, 'IMPORTED'::character varying, 'EXPORTED'::character varying, 'RECONCILED'::character varying, 'ERROR'::character varying])::text[]))),
    CONSTRAINT ck_budget_lines_within_allocation CHECK (((committed_amount + spent_amount) <= allocated_amount))
);


--
-- Name: budget_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_lines_id_seq OWNED BY public.budget_lines.id;


--
-- Name: budget_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_sync_logs (
    id integer NOT NULL,
    sync_type character varying(20) NOT NULL,
    filename character varying(255),
    records_processed integer NOT NULL,
    success_count integer NOT NULL,
    error_count integer NOT NULL,
    sync_status character varying(20) NOT NULL,
    log_data jsonb,
    performed_by integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: budget_sync_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_sync_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_sync_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_sync_logs_id_seq OWNED BY public.budget_sync_logs.id;


--
-- Name: budget_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_transactions (
    id bigint NOT NULL,
    budget_line_id integer NOT NULL,
    claim_id integer,
    payment_record_id integer,
    kind character varying(20) NOT NULL,
    amount numeric(15,2) NOT NULL,
    actor_id integer,
    reason text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_budget_transactions_kind CHECK (((kind)::text = ANY ((ARRAY['ALLOCATE'::character varying, 'COMMIT'::character varying, 'RELEASE'::character varying, 'SPEND'::character varying, 'REALLOCATE_IN'::character varying, 'REALLOCATE_OUT'::character varying, 'IMPORT_ADJUST'::character varying])::text[])))
);


--
-- Name: budget_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_transactions_id_seq OWNED BY public.budget_transactions.id;


--
-- Name: cadre_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cadre_form_fields (
    id integer NOT NULL,
    cadre_id integer NOT NULL,
    key character varying(80) NOT NULL,
    label_en character varying(255) NOT NULL,
    label_sw character varying(255),
    field_type character varying(20) NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean NOT NULL,
    CONSTRAINT ck_cadre_form_fields_field_type CHECK (((field_type)::text = ANY ((ARRAY['INTEGER'::character varying, 'BOOLEAN'::character varying])::text[])))
);


--
-- Name: cadre_form_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cadre_form_fields_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cadre_form_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cadre_form_fields_id_seq OWNED BY public.cadre_form_fields.id;


--
-- Name: cadres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cadres (
    id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    form_title character varying(255),
    hours_mode character varying(20) NOT NULL,
    uses_facility_geofence boolean NOT NULL,
    requires_facility_endorsement boolean NOT NULL,
    occupation_options jsonb NOT NULL,
    uses_section boolean NOT NULL,
    is_active boolean NOT NULL,
    technical_reviewer_title character varying(255),
    CONSTRAINT ck_cadres_hours_mode CHECK (((hours_mode)::text = ANY ((ARRAY['DIRECT'::character varying, 'START_END'::character varying])::text[])))
);


--
-- Name: cadres_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cadres_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cadres_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cadres_id_seq OWNED BY public.cadres.id;


--
-- Name: claim_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_audit (
    id bigint NOT NULL,
    claim_id integer NOT NULL,
    actor_id integer,
    actor_role character varying(50),
    action character varying(50) NOT NULL,
    old_status character varying(40),
    new_status character varying(40),
    old_payment_status character varying(40),
    new_payment_status character varying(40),
    comment text,
    details jsonb,
    "timestamp" timestamp with time zone NOT NULL
);


--
-- Name: claim_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_audit_id_seq OWNED BY public.claim_audit.id;


--
-- Name: claim_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_categories (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    form_type character varying(50),
    route_id integer,
    funding_source_id integer,
    payor_org_id integer,
    budget_owner character varying(20) NOT NULL,
    origin_channel character varying(20) NOT NULL,
    budget_line_code character varying(100),
    requires_work_log boolean NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_claim_categories_budget_owner CHECK (((budget_owner)::text = ANY ((ARRAY['PAYOR'::character varying, 'EXECUTOR'::character varying])::text[]))),
    CONSTRAINT ck_claim_categories_origin_channel CHECK (((origin_channel)::text = ANY ((ARRAY['FACILITY'::character varying, 'COMMUNITY'::character varying])::text[])))
);


--
-- Name: claim_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_categories_id_seq OWNED BY public.claim_categories.id;


--
-- Name: claim_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_components (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    rate_rule_id integer,
    component_name character varying(255) NOT NULL,
    unit_type character varying(20),
    measure_key character varying(80),
    units numeric(12,2) NOT NULL,
    rate numeric(15,2) NOT NULL,
    amount numeric(15,2) NOT NULL
);


--
-- Name: claim_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_components_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_components_id_seq OWNED BY public.claim_components.id;


--
-- Name: clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clusters (
    id integer NOT NULL,
    region_id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: clusters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clusters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clusters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clusters_id_seq OWNED BY public.clusters.id;


--
-- Name: community_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_areas (
    id integer NOT NULL,
    district_id integer NOT NULL,
    ward_id integer,
    name character varying(255) NOT NULL,
    geofence_lat numeric(10,8),
    geofence_lon numeric(11,8),
    geofence_radius_meters integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: community_areas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.community_areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: community_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.community_areas_id_seq OWNED BY public.community_areas.id;


--
-- Name: cso_region_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cso_region_assignments (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    region_id integer NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: cso_region_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cso_region_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cso_region_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cso_region_assignments_id_seq OWNED BY public.cso_region_assignments.id;


--
-- Name: districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.districts (
    id integer NOT NULL,
    region_id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: districts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.districts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: districts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.districts_id_seq OWNED BY public.districts.id;


--
-- Name: facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facilities (
    id integer NOT NULL,
    ward_id integer NOT NULL,
    cluster_id integer,
    name character varying(255) NOT NULL,
    facility_type character varying(50),
    geofence_lat numeric(10,8),
    geofence_lon numeric(11,8),
    geofence_radius_meters integer,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: facilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: facilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facilities_id_seq OWNED BY public.facilities.id;


--
-- Name: finance_monthly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_monthly_reports (
    id integer NOT NULL,
    region_id integer NOT NULL,
    month character varying(7) NOT NULL,
    work_type character varying(16) NOT NULL,
    approved_by integer NOT NULL,
    approved_at timestamp with time zone NOT NULL,
    digest character varying(64) NOT NULL,
    snapshot jsonb NOT NULL
);


--
-- Name: finance_monthly_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_monthly_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_monthly_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_monthly_reports_id_seq OWNED BY public.finance_monthly_reports.id;


--
-- Name: funding_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funding_sources (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL
);


--
-- Name: funding_sources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.funding_sources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: funding_sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.funding_sources_id_seq OWNED BY public.funding_sources.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50),
    type character varying(20) NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_organizations_type CHECK (((type)::text = ANY ((ARRAY['FHI360'::character varying, 'CSO'::character varying, 'PAYOR'::character varying, 'PARTNER'::character varying])::text[])))
);


--
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;


--
-- Name: otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_challenges (
    id integer NOT NULL,
    work_log_id integer NOT NULL,
    version integer NOT NULL,
    code_hash character varying(128) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer NOT NULL,
    is_used boolean NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: otp_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.otp_challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: otp_challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.otp_challenges_id_seq OWNED BY public.otp_challenges.id;


--
-- Name: pay_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_periods (
    id integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    period_label character varying(100),
    status character varying(20) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    region_id integer,
    CONSTRAINT ck_pay_periods_dates CHECK ((end_date >= start_date)),
    CONSTRAINT ck_pay_periods_status CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'CLOSED'::character varying, 'ARCHIVED'::character varying])::text[])))
);


--
-- Name: pay_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pay_periods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pay_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pay_periods_id_seq OWNED BY public.pay_periods.id;


--
-- Name: payment_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_claims (
    id integer NOT NULL,
    work_log_id integer,
    staff_id integer NOT NULL,
    category_id integer,
    period_id integer NOT NULL,
    assignment_id integer,
    community_area_id integer,
    route_code character varying(5),
    funding_source_id integer,
    payor_org_id integer,
    executor_org_id integer,
    budget_line_id integer,
    origin_channel character varying(20),
    evidence_text text,
    declared_units jsonb,
    amount numeric(15,2) NOT NULL,
    currency character varying(10) NOT NULL,
    status character varying(40) NOT NULL,
    payment_status character varying(40) NOT NULL,
    exception_reason text,
    calculation_snapshot jsonb,
    batch_id integer,
    created_by integer NOT NULL,
    verified_by integer,
    verified_at timestamp with time zone,
    approved_by integer,
    approved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workflow_version integer DEFAULT 1 NOT NULL,
    work_type character varying(20) DEFAULT 'LEGACY'::character varying NOT NULL,
    CONSTRAINT ck_payment_claims_amount CHECK ((amount >= (0)::numeric)),
    CONSTRAINT ck_payment_claims_pending_finance_category CHECK (((category_id IS NOT NULL) OR ((workflow_version >= 2) AND (work_log_id IS NOT NULL) AND ((status)::text = ANY ((ARRAY['PENDING_FINANCE_REVIEW'::character varying, 'CANCELLED'::character varying])::text[]))))),
    CONSTRAINT ck_payment_claims_route CHECK (((route_code IS NULL) OR ((route_code)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying, 'C'::character varying])::text[]))))
);


--
-- Name: payment_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_claims_id_seq OWNED BY public.payment_claims.id;


--
-- Name: payment_proofs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_proofs (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    payment_record_id integer,
    storage_key character varying(255) NOT NULL,
    original_filename character varying(255) NOT NULL,
    content_type character varying(100) NOT NULL,
    size_bytes integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    uploaded_by integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    beneficiary_snapshot jsonb
);


--
-- Name: payment_proofs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_proofs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_proofs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_proofs_id_seq OWNED BY public.payment_proofs.id;


--
-- Name: payment_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_records (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    executor_org_id integer,
    payment_reference character varying(255) NOT NULL,
    payment_method character varying(50),
    amount numeric(15,2) NOT NULL,
    payment_date date NOT NULL,
    status character varying(20) NOT NULL,
    recorded_by integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_payment_records_amount CHECK ((amount >= (0)::numeric)),
    CONSTRAINT ck_payment_records_status CHECK (((status)::text = ANY ((ARRAY['PAID'::character varying, 'PARTIAL'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: payment_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_records_id_seq OWNED BY public.payment_records.id;


--
-- Name: payment_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_routes (
    id integer NOT NULL,
    code character varying(5) NOT NULL,
    name character varying(100) NOT NULL,
    description text
);


--
-- Name: payment_routes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_routes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_routes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_routes_id_seq OWNED BY public.payment_routes.id;


--
-- Name: payroll_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_batches (
    id integer NOT NULL,
    reference character varying(50) NOT NULL,
    route_code character varying(5) NOT NULL,
    payor_org_id integer,
    executor_org_id integer NOT NULL,
    status character varying(30) NOT NULL,
    line_count integer NOT NULL,
    total_amount numeric(15,2) NOT NULL,
    currency character varying(10) NOT NULL,
    export_snapshot jsonb NOT NULL,
    export_csv text NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    handed_off_by integer,
    handed_off_at timestamp with time zone,
    received_by integer,
    received_at timestamp with time zone
);


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_batches_id_seq OWNED BY public.payroll_batches.id;


--
-- Name: rate_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_rules (
    id integer NOT NULL,
    category_id integer NOT NULL,
    cadre_id integer,
    region_id integer,
    component_name character varying(255) NOT NULL,
    unit_type character varying(20) NOT NULL,
    measure_key character varying(80),
    rate_value numeric(15,2) NOT NULL,
    currency character varying(10) NOT NULL,
    cap_amount numeric(15,2),
    effective_start_date date NOT NULL,
    effective_end_date date,
    status character varying(20) NOT NULL,
    created_by integer NOT NULL,
    approved_by integer,
    approved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_rate_rules_measure CHECK ((((unit_type)::text <> 'PER_UNIT'::text) OR (measure_key IS NOT NULL))),
    CONSTRAINT ck_rate_rules_rate CHECK ((rate_value >= (0)::numeric)),
    CONSTRAINT ck_rate_rules_status CHECK (((status)::text = ANY ((ARRAY['PENDING_APPROVAL'::character varying, 'ACTIVE'::character varying, 'REJECTED'::character varying, 'RETIRED'::character varying])::text[]))),
    CONSTRAINT ck_rate_rules_unit_type CHECK (((unit_type)::text = ANY ((ARRAY['PER_DAY'::character varying, 'PER_HOUR'::character varying, 'PER_UNIT'::character varying, 'FIXED'::character varying])::text[])))
);


--
-- Name: rate_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_rules_id_seq OWNED BY public.rate_rules.id;


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: regions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.regions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.regions_id_seq OWNED BY public.regions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(255)
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: roster_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_imports (
    id integer NOT NULL,
    filename character varying(255),
    enrollment_source character varying(30) NOT NULL,
    uploaded_by integer NOT NULL,
    total_rows integer NOT NULL,
    created_count integer NOT NULL,
    updated_count integer NOT NULL,
    error_count integer NOT NULL,
    errors jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: roster_imports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roster_imports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roster_imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roster_imports_id_seq OWNED BY public.roster_imports.id;


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL
);


--
-- Name: sms_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_outbox (
    id integer NOT NULL,
    event_name character varying(100) NOT NULL,
    user_id integer,
    destination_phone character varying(20) NOT NULL,
    language character varying(5),
    template_id integer,
    message_body text NOT NULL,
    status character varying(20) NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at timestamp with time zone,
    last_error text,
    provider_message_id character varying(255),
    related_type character varying(30),
    related_id integer,
    related_status character varying(50),
    created_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: sms_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_outbox_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_outbox_id_seq OWNED BY public.sms_outbox.id;


--
-- Name: sms_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_templates (
    id integer NOT NULL,
    event_name character varying(100) NOT NULL,
    language character varying(5) NOT NULL,
    version integer NOT NULL,
    template_text text NOT NULL,
    is_active boolean NOT NULL,
    created_by integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: sms_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_templates_id_seq OWNED BY public.sms_templates.id;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id integer NOT NULL,
    user_id integer,
    cadre_id integer NOT NULL,
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    last_name character varying(100) NOT NULL,
    verified_phone character varying(20) NOT NULL,
    occupation character varying(100),
    occupation_other character varying(100),
    salary_scale character varying(50),
    status character varying(20) NOT NULL,
    employment_start_date date,
    employment_end_date date,
    enrollment_source character varying(30) NOT NULL,
    payment_method character varying(30),
    payment_provider character varying(100),
    payment_account character varying(100),
    created_by integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    bank_name character varying(100),
    bank_account_number character varying(34),
    bank_branch character varying(100),
    mobile_money_number character varying(20),
    payment_details_updated_at timestamp with time zone,
    CONSTRAINT ck_staff_enrollment_source CHECK (((enrollment_source)::text = ANY ((ARRAY['ROSTER_IMPORT'::character varying, 'ENGAGEMENT_LIST'::character varying, 'MANUAL'::character varying])::text[]))),
    CONSTRAINT ck_staff_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'EXITED'::character varying])::text[])))
);


--
-- Name: staff_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_assignments (
    id integer NOT NULL,
    staff_id integer NOT NULL,
    region_id integer NOT NULL,
    district_id integer,
    ward_id integer,
    facility_id integer,
    community_area_id integer,
    section character varying(20),
    organization_id integer,
    start_date date NOT NULL,
    end_date date,
    is_primary boolean NOT NULL,
    end_reason character varying(255),
    created_by integer,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_staff_assignments_dates CHECK (((end_date IS NULL) OR (end_date >= start_date)))
);


--
-- Name: staff_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_assignments_id_seq OWNED BY public.staff_assignments.id;


--
-- Name: staff_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_change_requests (
    id integer NOT NULL,
    staff_id integer NOT NULL,
    changes jsonb NOT NULL,
    reason text NOT NULL,
    status character varying(20) NOT NULL,
    requested_by integer NOT NULL,
    decided_by integer,
    decided_at timestamp with time zone,
    decision_comment text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: staff_change_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_change_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_change_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_change_requests_id_seq OWNED BY public.staff_change_requests.id;


--
-- Name: staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_id_seq OWNED BY public.staff.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    updated_by integer,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: user_review_cadres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_review_cadres (
    user_id integer NOT NULL,
    cadre_id integer NOT NULL,
    assigned_by integer,
    assigned_at timestamp with time zone NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    assigned_by integer,
    assigned_at timestamp with time zone NOT NULL
);


--
-- Name: user_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_scopes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    region_id integer,
    cluster_id integer,
    facility_id integer,
    community_area_id integer,
    organization_id integer,
    created_by integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_scopes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_scopes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_scopes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_scopes_id_seq OWNED BY public.user_scopes.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    hashed_password character varying(255) NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(20) NOT NULL,
    preferred_language character varying(5) NOT NULL,
    is_active boolean NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    password_changed_at timestamp with time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: work_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_logs (
    id integer NOT NULL,
    staff_id integer NOT NULL,
    period_id integer NOT NULL,
    assignment_id integer NOT NULL,
    cadre_id integer NOT NULL,
    occupation character varying(100),
    occupation_other character varying(100),
    section character varying(20),
    status character varying(50) NOT NULL,
    version integer NOT NULL,
    confirmed_version integer,
    period_comment text,
    attested_at timestamp with time zone,
    submit_gps_lat numeric(10,8),
    submit_gps_lon numeric(11,8),
    submit_gps_accuracy_m numeric(8,2),
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    status_changed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workflow_version integer DEFAULT 1 NOT NULL,
    work_type character varying(20) DEFAULT 'LEGACY'::character varying NOT NULL,
    finance_snapshot jsonb,
    routed_channel character varying(20)
);


--
-- Name: vw_workflow_bottlenecks; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_workflow_bottlenecks AS
 SELECT w.id AS work_log_id,
    concat_ws(' '::text, s.first_name, s.middle_name, s.last_name) AS provider,
    c.code AS cadre,
    w.status,
    w.status_changed_at,
    (now() - w.status_changed_at) AS aging,
        CASE w.status
            WHEN 'PENDING_CTC_VERIFICATION'::text THEN 'CTC In-Charge / Supervisor'::text
            WHEN 'PENDING_PROVIDER_OTP_CONFIRMATION'::text THEN 'Provider (OTP)'::text
            WHEN 'PENDING_TECHNICAL_REVIEW'::text THEN 'Technical Officer'::text
            WHEN 'PENDING_RPM_AUTHORIZATION'::text THEN 'RPM'::text
            WHEN 'BUDGET_HOLD'::text THEN 'RPM (budget hold)'::text
            ELSE NULL::text
        END AS current_owner,
    a.region_id,
    a.facility_id
   FROM (((public.work_logs w
     JOIN public.staff s ON ((s.id = w.staff_id)))
     JOIN public.cadres c ON ((c.id = w.cadre_id)))
     JOIN public.staff_assignments a ON ((a.id = w.assignment_id)))
  WHERE ((w.status)::text = ANY ((ARRAY['PENDING_CTC_VERIFICATION'::character varying, 'PENDING_PROVIDER_OTP_CONFIRMATION'::character varying, 'PENDING_TECHNICAL_REVIEW'::character varying, 'PENDING_RPM_AUTHORIZATION'::character varying, 'BUDGET_HOLD'::character varying])::text[]));


--
-- Name: wards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wards (
    id integer NOT NULL,
    district_id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: wards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wards_id_seq OWNED BY public.wards.id;


--
-- Name: work_log_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_log_audit (
    id bigint NOT NULL,
    work_log_id integer NOT NULL,
    version integer,
    actor_id integer,
    actor_role character varying(50),
    action character varying(50) NOT NULL,
    old_status character varying(50),
    new_status character varying(50),
    comment text,
    details jsonb,
    "timestamp" timestamp with time zone NOT NULL
);


--
-- Name: work_log_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_log_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_log_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_log_audit_id_seq OWNED BY public.work_log_audit.id;


--
-- Name: work_log_endorsements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_log_endorsements (
    id integer NOT NULL,
    work_log_id integer NOT NULL,
    version integer NOT NULL,
    kind character varying(50) NOT NULL,
    actor_id integer NOT NULL,
    comment text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: work_log_endorsements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_log_endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_log_endorsements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_log_endorsements_id_seq OWNED BY public.work_log_endorsements.id;


--
-- Name: work_log_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_log_entries (
    id integer NOT NULL,
    work_log_id integer NOT NULL,
    entry_date date NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    hours_worked numeric(5,2) NOT NULL,
    evidence_text text NOT NULL,
    comment text,
    gps_lat numeric(10,8),
    gps_lon numeric(11,8),
    gps_accuracy_m numeric(8,2),
    gps_captured_at timestamp with time zone,
    location_status character varying(30) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    activity_key character varying(80),
    activity_location character varying(255),
    activity_snapshot jsonb,
    CONSTRAINT ck_work_log_entries_hours CHECK (((hours_worked > (0)::numeric) AND (hours_worked <= (24)::numeric)))
);


--
-- Name: work_log_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_log_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_log_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_log_entries_id_seq OWNED BY public.work_log_entries.id;


--
-- Name: work_log_measures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_log_measures (
    id integer NOT NULL,
    entry_id integer NOT NULL,
    field_key character varying(80) NOT NULL,
    value numeric(10,2) NOT NULL,
    CONSTRAINT ck_work_log_measures_value CHECK ((value >= (0)::numeric))
);


--
-- Name: work_log_measures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_log_measures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_log_measures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_log_measures_id_seq OWNED BY public.work_log_measures.id;


--
-- Name: work_log_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_log_versions (
    id integer NOT NULL,
    work_log_id integer NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: work_log_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_log_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_log_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_log_versions_id_seq OWNED BY public.work_log_versions.id;


--
-- Name: work_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_logs_id_seq OWNED BY public.work_logs.id;


--
-- Name: activity_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates ALTER COLUMN id SET DEFAULT nextval('public.activity_rates_id_seq'::regclass);


--
-- Name: audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ALTER COLUMN id SET DEFAULT nextval('public.audit_events_id_seq'::regclass);


--
-- Name: backdate_access id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backdate_access ALTER COLUMN id SET DEFAULT nextval('public.backdate_access_id_seq'::regclass);


--
-- Name: budget_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines ALTER COLUMN id SET DEFAULT nextval('public.budget_lines_id_seq'::regclass);


--
-- Name: budget_sync_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_sync_logs ALTER COLUMN id SET DEFAULT nextval('public.budget_sync_logs_id_seq'::regclass);


--
-- Name: budget_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions ALTER COLUMN id SET DEFAULT nextval('public.budget_transactions_id_seq'::regclass);


--
-- Name: cadre_form_fields id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadre_form_fields ALTER COLUMN id SET DEFAULT nextval('public.cadre_form_fields_id_seq'::regclass);


--
-- Name: cadres id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadres ALTER COLUMN id SET DEFAULT nextval('public.cadres_id_seq'::regclass);


--
-- Name: claim_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_audit ALTER COLUMN id SET DEFAULT nextval('public.claim_audit_id_seq'::regclass);


--
-- Name: claim_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories ALTER COLUMN id SET DEFAULT nextval('public.claim_categories_id_seq'::regclass);


--
-- Name: claim_components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_components ALTER COLUMN id SET DEFAULT nextval('public.claim_components_id_seq'::regclass);


--
-- Name: clusters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters ALTER COLUMN id SET DEFAULT nextval('public.clusters_id_seq'::regclass);


--
-- Name: community_areas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_areas ALTER COLUMN id SET DEFAULT nextval('public.community_areas_id_seq'::regclass);


--
-- Name: cso_region_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cso_region_assignments ALTER COLUMN id SET DEFAULT nextval('public.cso_region_assignments_id_seq'::regclass);


--
-- Name: districts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts ALTER COLUMN id SET DEFAULT nextval('public.districts_id_seq'::regclass);


--
-- Name: facilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities ALTER COLUMN id SET DEFAULT nextval('public.facilities_id_seq'::regclass);


--
-- Name: finance_monthly_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_monthly_reports ALTER COLUMN id SET DEFAULT nextval('public.finance_monthly_reports_id_seq'::regclass);


--
-- Name: funding_sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources ALTER COLUMN id SET DEFAULT nextval('public.funding_sources_id_seq'::regclass);


--
-- Name: organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);


--
-- Name: otp_challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges ALTER COLUMN id SET DEFAULT nextval('public.otp_challenges_id_seq'::regclass);


--
-- Name: pay_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_periods ALTER COLUMN id SET DEFAULT nextval('public.pay_periods_id_seq'::regclass);


--
-- Name: payment_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims ALTER COLUMN id SET DEFAULT nextval('public.payment_claims_id_seq'::regclass);


--
-- Name: payment_proofs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs ALTER COLUMN id SET DEFAULT nextval('public.payment_proofs_id_seq'::regclass);


--
-- Name: payment_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records ALTER COLUMN id SET DEFAULT nextval('public.payment_records_id_seq'::regclass);


--
-- Name: payment_routes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_routes ALTER COLUMN id SET DEFAULT nextval('public.payment_routes_id_seq'::regclass);


--
-- Name: payroll_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches ALTER COLUMN id SET DEFAULT nextval('public.payroll_batches_id_seq'::regclass);


--
-- Name: rate_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules ALTER COLUMN id SET DEFAULT nextval('public.rate_rules_id_seq'::regclass);


--
-- Name: regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions ALTER COLUMN id SET DEFAULT nextval('public.regions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: roster_imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_imports ALTER COLUMN id SET DEFAULT nextval('public.roster_imports_id_seq'::regclass);


--
-- Name: sms_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_outbox ALTER COLUMN id SET DEFAULT nextval('public.sms_outbox_id_seq'::regclass);


--
-- Name: sms_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates ALTER COLUMN id SET DEFAULT nextval('public.sms_templates_id_seq'::regclass);


--
-- Name: staff id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff ALTER COLUMN id SET DEFAULT nextval('public.staff_id_seq'::regclass);


--
-- Name: staff_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments ALTER COLUMN id SET DEFAULT nextval('public.staff_assignments_id_seq'::regclass);


--
-- Name: staff_change_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_change_requests ALTER COLUMN id SET DEFAULT nextval('public.staff_change_requests_id_seq'::regclass);


--
-- Name: user_scopes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes ALTER COLUMN id SET DEFAULT nextval('public.user_scopes_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wards ALTER COLUMN id SET DEFAULT nextval('public.wards_id_seq'::regclass);


--
-- Name: work_log_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_audit ALTER COLUMN id SET DEFAULT nextval('public.work_log_audit_id_seq'::regclass);


--
-- Name: work_log_endorsements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_endorsements ALTER COLUMN id SET DEFAULT nextval('public.work_log_endorsements_id_seq'::regclass);


--
-- Name: work_log_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_entries ALTER COLUMN id SET DEFAULT nextval('public.work_log_entries_id_seq'::regclass);


--
-- Name: work_log_measures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_measures ALTER COLUMN id SET DEFAULT nextval('public.work_log_measures_id_seq'::regclass);


--
-- Name: work_log_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_versions ALTER COLUMN id SET DEFAULT nextval('public.work_log_versions_id_seq'::regclass);


--
-- Name: work_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs ALTER COLUMN id SET DEFAULT nextval('public.work_logs_id_seq'::regclass);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: activity_rates pk_activity_rates; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT pk_activity_rates PRIMARY KEY (id);


--
-- Name: audit_events pk_audit_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT pk_audit_events PRIMARY KEY (id);


--
-- Name: backdate_access pk_backdate_access; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backdate_access
    ADD CONSTRAINT pk_backdate_access PRIMARY KEY (id);


--
-- Name: budget_lines pk_budget_lines; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT pk_budget_lines PRIMARY KEY (id);


--
-- Name: budget_sync_logs pk_budget_sync_logs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_sync_logs
    ADD CONSTRAINT pk_budget_sync_logs PRIMARY KEY (id);


--
-- Name: budget_transactions pk_budget_transactions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions
    ADD CONSTRAINT pk_budget_transactions PRIMARY KEY (id);


--
-- Name: cadre_form_fields pk_cadre_form_fields; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadre_form_fields
    ADD CONSTRAINT pk_cadre_form_fields PRIMARY KEY (id);


--
-- Name: cadres pk_cadres; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadres
    ADD CONSTRAINT pk_cadres PRIMARY KEY (id);


--
-- Name: claim_audit pk_claim_audit; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_audit
    ADD CONSTRAINT pk_claim_audit PRIMARY KEY (id);


--
-- Name: claim_categories pk_claim_categories; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories
    ADD CONSTRAINT pk_claim_categories PRIMARY KEY (id);


--
-- Name: claim_components pk_claim_components; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_components
    ADD CONSTRAINT pk_claim_components PRIMARY KEY (id);


--
-- Name: clusters pk_clusters; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT pk_clusters PRIMARY KEY (id);


--
-- Name: community_areas pk_community_areas; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_areas
    ADD CONSTRAINT pk_community_areas PRIMARY KEY (id);


--
-- Name: cso_region_assignments pk_cso_region_assignments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cso_region_assignments
    ADD CONSTRAINT pk_cso_region_assignments PRIMARY KEY (id);


--
-- Name: districts pk_districts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT pk_districts PRIMARY KEY (id);


--
-- Name: facilities pk_facilities; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT pk_facilities PRIMARY KEY (id);


--
-- Name: finance_monthly_reports pk_finance_monthly_reports; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_monthly_reports
    ADD CONSTRAINT pk_finance_monthly_reports PRIMARY KEY (id);


--
-- Name: funding_sources pk_funding_sources; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources
    ADD CONSTRAINT pk_funding_sources PRIMARY KEY (id);


--
-- Name: organizations pk_organizations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT pk_organizations PRIMARY KEY (id);


--
-- Name: otp_challenges pk_otp_challenges; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT pk_otp_challenges PRIMARY KEY (id);


--
-- Name: pay_periods pk_pay_periods; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_periods
    ADD CONSTRAINT pk_pay_periods PRIMARY KEY (id);


--
-- Name: payment_claims pk_payment_claims; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT pk_payment_claims PRIMARY KEY (id);


--
-- Name: payment_proofs pk_payment_proofs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT pk_payment_proofs PRIMARY KEY (id);


--
-- Name: payment_records pk_payment_records; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT pk_payment_records PRIMARY KEY (id);


--
-- Name: payment_routes pk_payment_routes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_routes
    ADD CONSTRAINT pk_payment_routes PRIMARY KEY (id);


--
-- Name: payroll_batches pk_payroll_batches; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT pk_payroll_batches PRIMARY KEY (id);


--
-- Name: rate_rules pk_rate_rules; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT pk_rate_rules PRIMARY KEY (id);


--
-- Name: regions pk_regions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT pk_regions PRIMARY KEY (id);


--
-- Name: roles pk_roles; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT pk_roles PRIMARY KEY (id);


--
-- Name: roster_imports pk_roster_imports; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_imports
    ADD CONSTRAINT pk_roster_imports PRIMARY KEY (id);


--
-- Name: sections pk_sections; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT pk_sections PRIMARY KEY (code);


--
-- Name: sms_outbox pk_sms_outbox; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_outbox
    ADD CONSTRAINT pk_sms_outbox PRIMARY KEY (id);


--
-- Name: sms_templates pk_sms_templates; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT pk_sms_templates PRIMARY KEY (id);


--
-- Name: staff pk_staff; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT pk_staff PRIMARY KEY (id);


--
-- Name: staff_assignments pk_staff_assignments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT pk_staff_assignments PRIMARY KEY (id);


--
-- Name: staff_change_requests pk_staff_change_requests; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_change_requests
    ADD CONSTRAINT pk_staff_change_requests PRIMARY KEY (id);


--
-- Name: system_settings pk_system_settings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT pk_system_settings PRIMARY KEY (key);


--
-- Name: user_review_cadres pk_user_review_cadres; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_review_cadres
    ADD CONSTRAINT pk_user_review_cadres PRIMARY KEY (user_id, cadre_id);


--
-- Name: user_roles pk_user_roles; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id);


--
-- Name: user_scopes pk_user_scopes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT pk_user_scopes PRIMARY KEY (id);


--
-- Name: users pk_users; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT pk_users PRIMARY KEY (id);


--
-- Name: wards pk_wards; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wards
    ADD CONSTRAINT pk_wards PRIMARY KEY (id);


--
-- Name: work_log_audit pk_work_log_audit; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_audit
    ADD CONSTRAINT pk_work_log_audit PRIMARY KEY (id);


--
-- Name: work_log_endorsements pk_work_log_endorsements; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_endorsements
    ADD CONSTRAINT pk_work_log_endorsements PRIMARY KEY (id);


--
-- Name: work_log_entries pk_work_log_entries; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_entries
    ADD CONSTRAINT pk_work_log_entries PRIMARY KEY (id);


--
-- Name: work_log_measures pk_work_log_measures; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_measures
    ADD CONSTRAINT pk_work_log_measures PRIMARY KEY (id);


--
-- Name: work_log_versions pk_work_log_versions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_versions
    ADD CONSTRAINT pk_work_log_versions PRIMARY KEY (id);


--
-- Name: work_logs pk_work_logs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT pk_work_logs PRIMARY KEY (id);


--
-- Name: activity_rates uq_activity_rates_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT uq_activity_rates_key UNIQUE (key);


--
-- Name: budget_lines uq_budget_lines_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT uq_budget_lines_code UNIQUE (code, organization_id, period_id, region_id);


--
-- Name: cadre_form_fields uq_cadre_form_fields_cadre_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadre_form_fields
    ADD CONSTRAINT uq_cadre_form_fields_cadre_id UNIQUE (cadre_id, key);


--
-- Name: cadres uq_cadres_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadres
    ADD CONSTRAINT uq_cadres_code UNIQUE (code);


--
-- Name: claim_categories uq_claim_categories_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories
    ADD CONSTRAINT uq_claim_categories_name UNIQUE (name);


--
-- Name: cso_region_assignments uq_cso_region_assignments_organization_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cso_region_assignments
    ADD CONSTRAINT uq_cso_region_assignments_organization_id UNIQUE (organization_id, region_id);


--
-- Name: funding_sources uq_funding_sources_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources
    ADD CONSTRAINT uq_funding_sources_code UNIQUE (code);


--
-- Name: organizations uq_organizations_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT uq_organizations_code UNIQUE (code);


--
-- Name: organizations uq_organizations_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT uq_organizations_name UNIQUE (name);


--
-- Name: payment_proofs uq_payment_proofs_storage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT uq_payment_proofs_storage_key UNIQUE (storage_key);


--
-- Name: payment_routes uq_payment_routes_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_routes
    ADD CONSTRAINT uq_payment_routes_code UNIQUE (code);


--
-- Name: payroll_batches uq_payroll_batches_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT uq_payroll_batches_reference UNIQUE (reference);


--
-- Name: regions uq_regions_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT uq_regions_name UNIQUE (name);


--
-- Name: roles uq_roles_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT uq_roles_name UNIQUE (name);


--
-- Name: sms_templates uq_sms_templates_event_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT uq_sms_templates_event_name UNIQUE (event_name, language, version);


--
-- Name: staff uq_staff_user_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT uq_staff_user_id UNIQUE (user_id);


--
-- Name: staff uq_staff_verified_phone; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT uq_staff_verified_phone UNIQUE (verified_phone);


--
-- Name: users uq_users_phone; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_phone UNIQUE (phone);


--
-- Name: users uq_users_username; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_username UNIQUE (username);


--
-- Name: work_log_endorsements uq_work_log_endorsements_work_log_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_endorsements
    ADD CONSTRAINT uq_work_log_endorsements_work_log_id UNIQUE (work_log_id, version, kind);


--
-- Name: work_log_entries uq_work_log_entries_work_log_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_entries
    ADD CONSTRAINT uq_work_log_entries_work_log_id UNIQUE (work_log_id, entry_date);


--
-- Name: work_log_measures uq_work_log_measures_entry_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_measures
    ADD CONSTRAINT uq_work_log_measures_entry_id UNIQUE (entry_id, field_key);


--
-- Name: work_log_versions uq_work_log_versions_work_log_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_versions
    ADD CONSTRAINT uq_work_log_versions_work_log_id UNIQUE (work_log_id, version);


--
-- Name: work_logs uq_work_logs_staff_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT uq_work_logs_staff_id UNIQUE (staff_id, period_id, work_type);


--
-- Name: ix_activity_rates_cadre_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_activity_rates_cadre_id ON public.activity_rates USING btree (cadre_id);


--
-- Name: ix_activity_rates_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_activity_rates_region_id ON public.activity_rates USING btree (region_id);


--
-- Name: ix_audit_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_events_created_at ON public.audit_events USING btree (created_at);


--
-- Name: ix_audit_events_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_events_entity_type ON public.audit_events USING btree (entity_type);


--
-- Name: ix_backdate_access_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_backdate_access_staff_id ON public.backdate_access USING btree (staff_id);


--
-- Name: ix_budget_lines_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_budget_lines_organization_id ON public.budget_lines USING btree (organization_id);


--
-- Name: ix_budget_transactions_budget_line_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_budget_transactions_budget_line_id ON public.budget_transactions USING btree (budget_line_id);


--
-- Name: ix_claim_audit_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_claim_audit_claim_id ON public.claim_audit USING btree (claim_id);


--
-- Name: ix_claim_components_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_claim_components_claim_id ON public.claim_components USING btree (claim_id);


--
-- Name: ix_clusters_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clusters_region_id ON public.clusters USING btree (region_id);


--
-- Name: ix_community_areas_district_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_community_areas_district_id ON public.community_areas USING btree (district_id);


--
-- Name: ix_cso_region_assignments_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cso_region_assignments_organization_id ON public.cso_region_assignments USING btree (organization_id);


--
-- Name: ix_cso_region_assignments_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cso_region_assignments_region_id ON public.cso_region_assignments USING btree (region_id);


--
-- Name: ix_districts_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_districts_region_id ON public.districts USING btree (region_id);


--
-- Name: ix_facilities_cluster_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_facilities_cluster_id ON public.facilities USING btree (cluster_id);


--
-- Name: ix_facilities_ward_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_facilities_ward_id ON public.facilities USING btree (ward_id);


--
-- Name: ix_finance_monthly_report_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_finance_monthly_report_lookup ON public.finance_monthly_reports USING btree (region_id, month, work_type, id);


--
-- Name: ix_otp_challenges_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_otp_challenges_work_log_id ON public.otp_challenges USING btree (work_log_id);


--
-- Name: ix_pay_periods_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pay_periods_region_id ON public.pay_periods USING btree (region_id);


--
-- Name: ix_payment_claims_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_batch_id ON public.payment_claims USING btree (batch_id);


--
-- Name: ix_payment_claims_executor_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_executor_org_id ON public.payment_claims USING btree (executor_org_id);


--
-- Name: ix_payment_claims_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_payment_status ON public.payment_claims USING btree (payment_status);


--
-- Name: ix_payment_claims_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_staff_id ON public.payment_claims USING btree (staff_id);


--
-- Name: ix_payment_claims_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_status ON public.payment_claims USING btree (status);


--
-- Name: ix_payment_claims_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_claims_work_log_id ON public.payment_claims USING btree (work_log_id);


--
-- Name: ix_payment_proofs_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_proofs_claim_id ON public.payment_proofs USING btree (claim_id);


--
-- Name: ix_payment_records_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_records_claim_id ON public.payment_records USING btree (claim_id);


--
-- Name: ix_payroll_batches_executor_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payroll_batches_executor_org_id ON public.payroll_batches USING btree (executor_org_id);


--
-- Name: ix_rate_rules_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rate_rules_category_id ON public.rate_rules USING btree (category_id);


--
-- Name: ix_sms_outbox_event_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sms_outbox_event_name ON public.sms_outbox USING btree (event_name);


--
-- Name: ix_sms_outbox_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sms_outbox_status ON public.sms_outbox USING btree (status);


--
-- Name: ix_staff_assignments_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_assignments_staff_id ON public.staff_assignments USING btree (staff_id);


--
-- Name: ix_staff_change_requests_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_change_requests_staff_id ON public.staff_change_requests USING btree (staff_id);


--
-- Name: ix_user_scopes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_scopes_user_id ON public.user_scopes USING btree (user_id);


--
-- Name: ix_wards_district_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wards_district_id ON public.wards USING btree (district_id);


--
-- Name: ix_work_log_audit_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_log_audit_work_log_id ON public.work_log_audit USING btree (work_log_id);


--
-- Name: ix_work_log_endorsements_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_log_endorsements_work_log_id ON public.work_log_endorsements USING btree (work_log_id);


--
-- Name: ix_work_log_entries_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_log_entries_work_log_id ON public.work_log_entries USING btree (work_log_id);


--
-- Name: ix_work_log_measures_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_log_measures_entry_id ON public.work_log_measures USING btree (entry_id);


--
-- Name: ix_work_log_versions_work_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_log_versions_work_log_id ON public.work_log_versions USING btree (work_log_id);


--
-- Name: ix_work_logs_period_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_logs_period_id ON public.work_logs USING btree (period_id);


--
-- Name: ix_work_logs_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_logs_staff_id ON public.work_logs USING btree (staff_id);


--
-- Name: ix_work_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_logs_status ON public.work_logs USING btree (status);


--
-- Name: uq_pay_periods_dates_region; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pay_periods_dates_region ON public.pay_periods USING btree (start_date, end_date, region_id) WHERE ((region_id IS NOT NULL) AND ((status)::text <> 'ARCHIVED'::text));


--
-- Name: uq_pay_periods_global_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pay_periods_global_dates ON public.pay_periods USING btree (start_date, end_date) WHERE ((region_id IS NULL) AND ((status)::text <> 'ARCHIVED'::text));


--
-- Name: uq_payment_claims_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payment_claims_live ON public.payment_claims USING btree (staff_id, category_id, period_id) WHERE ((status)::text <> 'CANCELLED'::text);


--
-- Name: finance_monthly_reports finance_monthly_reports_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER finance_monthly_reports_append_only BEFORE DELETE OR UPDATE ON public.finance_monthly_reports FOR EACH ROW EXECUTE FUNCTION public.hrh_prevent_modification();


--
-- Name: audit_events trg_audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.hrh_prevent_modification();


--
-- Name: budget_transactions trg_budget_transactions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_budget_transactions_append_only BEFORE DELETE OR UPDATE ON public.budget_transactions FOR EACH ROW EXECUTE FUNCTION public.hrh_prevent_modification();


--
-- Name: claim_audit trg_claim_audit_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_claim_audit_append_only BEFORE DELETE OR UPDATE ON public.claim_audit FOR EACH ROW EXECUTE FUNCTION public.hrh_prevent_modification();


--
-- Name: work_log_audit trg_work_log_audit_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_work_log_audit_append_only BEFORE DELETE OR UPDATE ON public.work_log_audit FOR EACH ROW EXECUTE FUNCTION public.hrh_prevent_modification();


--
-- Name: activity_rates fk_activity_rates_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT fk_activity_rates_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: activity_rates fk_activity_rates_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT fk_activity_rates_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: activity_rates fk_activity_rates_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT fk_activity_rates_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: activity_rates fk_activity_rates_supersedes_id_activity_rates; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_rates
    ADD CONSTRAINT fk_activity_rates_supersedes_id_activity_rates FOREIGN KEY (supersedes_id) REFERENCES public.activity_rates(id);


--
-- Name: audit_events fk_audit_events_actor_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT fk_audit_events_actor_id_users FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: backdate_access fk_backdate_access_assignment_id_staff_assignments; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backdate_access
    ADD CONSTRAINT fk_backdate_access_assignment_id_staff_assignments FOREIGN KEY (assignment_id) REFERENCES public.staff_assignments(id);


--
-- Name: backdate_access fk_backdate_access_granted_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backdate_access
    ADD CONSTRAINT fk_backdate_access_granted_by_users FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: backdate_access fk_backdate_access_staff_id_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backdate_access
    ADD CONSTRAINT fk_backdate_access_staff_id_staff FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: budget_lines fk_budget_lines_category_id_claim_categories; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT fk_budget_lines_category_id_claim_categories FOREIGN KEY (category_id) REFERENCES public.claim_categories(id);


--
-- Name: budget_lines fk_budget_lines_organization_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT fk_budget_lines_organization_id_organizations FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: budget_lines fk_budget_lines_period_id_pay_periods; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT fk_budget_lines_period_id_pay_periods FOREIGN KEY (period_id) REFERENCES public.pay_periods(id);


--
-- Name: budget_lines fk_budget_lines_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT fk_budget_lines_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: budget_sync_logs fk_budget_sync_logs_performed_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_sync_logs
    ADD CONSTRAINT fk_budget_sync_logs_performed_by_users FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: budget_transactions fk_budget_transactions_actor_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions
    ADD CONSTRAINT fk_budget_transactions_actor_id_users FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: budget_transactions fk_budget_transactions_budget_line_id_budget_lines; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions
    ADD CONSTRAINT fk_budget_transactions_budget_line_id_budget_lines FOREIGN KEY (budget_line_id) REFERENCES public.budget_lines(id);


--
-- Name: budget_transactions fk_budget_transactions_claim_id_payment_claims; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions
    ADD CONSTRAINT fk_budget_transactions_claim_id_payment_claims FOREIGN KEY (claim_id) REFERENCES public.payment_claims(id);


--
-- Name: budget_transactions fk_budget_transactions_payment_record_id_payment_records; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_transactions
    ADD CONSTRAINT fk_budget_transactions_payment_record_id_payment_records FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id);


--
-- Name: cadre_form_fields fk_cadre_form_fields_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadre_form_fields
    ADD CONSTRAINT fk_cadre_form_fields_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: claim_audit fk_claim_audit_actor_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_audit
    ADD CONSTRAINT fk_claim_audit_actor_id_users FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: claim_audit fk_claim_audit_claim_id_payment_claims; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_audit
    ADD CONSTRAINT fk_claim_audit_claim_id_payment_claims FOREIGN KEY (claim_id) REFERENCES public.payment_claims(id);


--
-- Name: claim_categories fk_claim_categories_funding_source_id_funding_sources; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories
    ADD CONSTRAINT fk_claim_categories_funding_source_id_funding_sources FOREIGN KEY (funding_source_id) REFERENCES public.funding_sources(id);


--
-- Name: claim_categories fk_claim_categories_payor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories
    ADD CONSTRAINT fk_claim_categories_payor_org_id_organizations FOREIGN KEY (payor_org_id) REFERENCES public.organizations(id);


--
-- Name: claim_categories fk_claim_categories_route_id_payment_routes; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_categories
    ADD CONSTRAINT fk_claim_categories_route_id_payment_routes FOREIGN KEY (route_id) REFERENCES public.payment_routes(id);


--
-- Name: claim_components fk_claim_components_claim_id_payment_claims; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_components
    ADD CONSTRAINT fk_claim_components_claim_id_payment_claims FOREIGN KEY (claim_id) REFERENCES public.payment_claims(id) ON DELETE CASCADE;


--
-- Name: claim_components fk_claim_components_rate_rule_id_rate_rules; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_components
    ADD CONSTRAINT fk_claim_components_rate_rule_id_rate_rules FOREIGN KEY (rate_rule_id) REFERENCES public.rate_rules(id);


--
-- Name: clusters fk_clusters_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT fk_clusters_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: community_areas fk_community_areas_district_id_districts; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_areas
    ADD CONSTRAINT fk_community_areas_district_id_districts FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- Name: community_areas fk_community_areas_ward_id_wards; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_areas
    ADD CONSTRAINT fk_community_areas_ward_id_wards FOREIGN KEY (ward_id) REFERENCES public.wards(id);


--
-- Name: cso_region_assignments fk_cso_region_assignments_organization_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cso_region_assignments
    ADD CONSTRAINT fk_cso_region_assignments_organization_id_organizations FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: cso_region_assignments fk_cso_region_assignments_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cso_region_assignments
    ADD CONSTRAINT fk_cso_region_assignments_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: districts fk_districts_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT fk_districts_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: facilities fk_facilities_cluster_id_clusters; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT fk_facilities_cluster_id_clusters FOREIGN KEY (cluster_id) REFERENCES public.clusters(id);


--
-- Name: facilities fk_facilities_ward_id_wards; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT fk_facilities_ward_id_wards FOREIGN KEY (ward_id) REFERENCES public.wards(id);


--
-- Name: finance_monthly_reports fk_finance_monthly_reports_approved_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_monthly_reports
    ADD CONSTRAINT fk_finance_monthly_reports_approved_by_users FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: finance_monthly_reports fk_finance_monthly_reports_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_monthly_reports
    ADD CONSTRAINT fk_finance_monthly_reports_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: otp_challenges fk_otp_challenges_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT fk_otp_challenges_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id);


--
-- Name: pay_periods fk_pay_periods_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_periods
    ADD CONSTRAINT fk_pay_periods_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: payment_claims fk_payment_claims_approved_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_approved_by_users FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payment_claims fk_payment_claims_assignment_id_staff_assignments; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_assignment_id_staff_assignments FOREIGN KEY (assignment_id) REFERENCES public.staff_assignments(id);


--
-- Name: payment_claims fk_payment_claims_batch_id_payroll_batches; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_batch_id_payroll_batches FOREIGN KEY (batch_id) REFERENCES public.payroll_batches(id);


--
-- Name: payment_claims fk_payment_claims_budget_line_id_budget_lines; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_budget_line_id_budget_lines FOREIGN KEY (budget_line_id) REFERENCES public.budget_lines(id);


--
-- Name: payment_claims fk_payment_claims_category_id_claim_categories; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_category_id_claim_categories FOREIGN KEY (category_id) REFERENCES public.claim_categories(id);


--
-- Name: payment_claims fk_payment_claims_community_area_id_community_areas; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_community_area_id_community_areas FOREIGN KEY (community_area_id) REFERENCES public.community_areas(id);


--
-- Name: payment_claims fk_payment_claims_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_claims fk_payment_claims_executor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_executor_org_id_organizations FOREIGN KEY (executor_org_id) REFERENCES public.organizations(id);


--
-- Name: payment_claims fk_payment_claims_funding_source_id_funding_sources; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_funding_source_id_funding_sources FOREIGN KEY (funding_source_id) REFERENCES public.funding_sources(id);


--
-- Name: payment_claims fk_payment_claims_payor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_payor_org_id_organizations FOREIGN KEY (payor_org_id) REFERENCES public.organizations(id);


--
-- Name: payment_claims fk_payment_claims_period_id_pay_periods; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_period_id_pay_periods FOREIGN KEY (period_id) REFERENCES public.pay_periods(id);


--
-- Name: payment_claims fk_payment_claims_staff_id_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_staff_id_staff FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: payment_claims fk_payment_claims_verified_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_verified_by_users FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: payment_claims fk_payment_claims_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_claims
    ADD CONSTRAINT fk_payment_claims_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id);


--
-- Name: payment_proofs fk_payment_proofs_claim_id_payment_claims; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT fk_payment_proofs_claim_id_payment_claims FOREIGN KEY (claim_id) REFERENCES public.payment_claims(id);


--
-- Name: payment_proofs fk_payment_proofs_payment_record_id_payment_records; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT fk_payment_proofs_payment_record_id_payment_records FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id);


--
-- Name: payment_proofs fk_payment_proofs_uploaded_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT fk_payment_proofs_uploaded_by_users FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: payment_records fk_payment_records_claim_id_payment_claims; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT fk_payment_records_claim_id_payment_claims FOREIGN KEY (claim_id) REFERENCES public.payment_claims(id);


--
-- Name: payment_records fk_payment_records_executor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT fk_payment_records_executor_org_id_organizations FOREIGN KEY (executor_org_id) REFERENCES public.organizations(id);


--
-- Name: payment_records fk_payment_records_recorded_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT fk_payment_records_recorded_by_users FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: payroll_batches fk_payroll_batches_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_payroll_batches_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payroll_batches fk_payroll_batches_executor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_payroll_batches_executor_org_id_organizations FOREIGN KEY (executor_org_id) REFERENCES public.organizations(id);


--
-- Name: payroll_batches fk_payroll_batches_handed_off_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_payroll_batches_handed_off_by_users FOREIGN KEY (handed_off_by) REFERENCES public.users(id);


--
-- Name: payroll_batches fk_payroll_batches_payor_org_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_payroll_batches_payor_org_id_organizations FOREIGN KEY (payor_org_id) REFERENCES public.organizations(id);


--
-- Name: payroll_batches fk_payroll_batches_received_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_payroll_batches_received_by_users FOREIGN KEY (received_by) REFERENCES public.users(id);


--
-- Name: rate_rules fk_rate_rules_approved_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT fk_rate_rules_approved_by_users FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: rate_rules fk_rate_rules_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT fk_rate_rules_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: rate_rules fk_rate_rules_category_id_claim_categories; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT fk_rate_rules_category_id_claim_categories FOREIGN KEY (category_id) REFERENCES public.claim_categories(id);


--
-- Name: rate_rules fk_rate_rules_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT fk_rate_rules_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: rate_rules fk_rate_rules_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT fk_rate_rules_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: roster_imports fk_roster_imports_uploaded_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_imports
    ADD CONSTRAINT fk_roster_imports_uploaded_by_users FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: sms_outbox fk_sms_outbox_template_id_sms_templates; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_outbox
    ADD CONSTRAINT fk_sms_outbox_template_id_sms_templates FOREIGN KEY (template_id) REFERENCES public.sms_templates(id);


--
-- Name: sms_outbox fk_sms_outbox_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_outbox
    ADD CONSTRAINT fk_sms_outbox_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sms_templates fk_sms_templates_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT fk_sms_templates_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: staff_assignments fk_staff_assignments_community_area_id_community_areas; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_community_area_id_community_areas FOREIGN KEY (community_area_id) REFERENCES public.community_areas(id);


--
-- Name: staff_assignments fk_staff_assignments_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: staff_assignments fk_staff_assignments_district_id_districts; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_district_id_districts FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- Name: staff_assignments fk_staff_assignments_facility_id_facilities; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_facility_id_facilities FOREIGN KEY (facility_id) REFERENCES public.facilities(id);


--
-- Name: staff_assignments fk_staff_assignments_organization_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_organization_id_organizations FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: staff_assignments fk_staff_assignments_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: staff_assignments fk_staff_assignments_section_sections; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_section_sections FOREIGN KEY (section) REFERENCES public.sections(code);


--
-- Name: staff_assignments fk_staff_assignments_staff_id_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_staff_id_staff FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: staff_assignments fk_staff_assignments_ward_id_wards; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT fk_staff_assignments_ward_id_wards FOREIGN KEY (ward_id) REFERENCES public.wards(id);


--
-- Name: staff fk_staff_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT fk_staff_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: staff_change_requests fk_staff_change_requests_decided_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_change_requests
    ADD CONSTRAINT fk_staff_change_requests_decided_by_users FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: staff_change_requests fk_staff_change_requests_requested_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_change_requests
    ADD CONSTRAINT fk_staff_change_requests_requested_by_users FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: staff_change_requests fk_staff_change_requests_staff_id_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_change_requests
    ADD CONSTRAINT fk_staff_change_requests_staff_id_staff FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: staff fk_staff_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT fk_staff_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: staff fk_staff_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT fk_staff_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: system_settings fk_system_settings_updated_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT fk_system_settings_updated_by_users FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: user_review_cadres fk_user_review_cadres_assigned_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_review_cadres
    ADD CONSTRAINT fk_user_review_cadres_assigned_by_users FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_review_cadres fk_user_review_cadres_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_review_cadres
    ADD CONSTRAINT fk_user_review_cadres_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: user_review_cadres fk_user_review_cadres_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_review_cadres
    ADD CONSTRAINT fk_user_review_cadres_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_roles fk_user_roles_assigned_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_assigned_by_users FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_roles fk_user_roles_role_id_roles; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_role_id_roles FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: user_roles fk_user_roles_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_scopes fk_user_scopes_cluster_id_clusters; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_cluster_id_clusters FOREIGN KEY (cluster_id) REFERENCES public.clusters(id);


--
-- Name: user_scopes fk_user_scopes_community_area_id_community_areas; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_community_area_id_community_areas FOREIGN KEY (community_area_id) REFERENCES public.community_areas(id);


--
-- Name: user_scopes fk_user_scopes_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: user_scopes fk_user_scopes_facility_id_facilities; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_facility_id_facilities FOREIGN KEY (facility_id) REFERENCES public.facilities(id);


--
-- Name: user_scopes fk_user_scopes_organization_id_organizations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_organization_id_organizations FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: user_scopes fk_user_scopes_region_id_regions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_region_id_regions FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: user_scopes fk_user_scopes_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT fk_user_scopes_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: wards fk_wards_district_id_districts; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wards
    ADD CONSTRAINT fk_wards_district_id_districts FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- Name: work_log_audit fk_work_log_audit_actor_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_audit
    ADD CONSTRAINT fk_work_log_audit_actor_id_users FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: work_log_audit fk_work_log_audit_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_audit
    ADD CONSTRAINT fk_work_log_audit_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id);


--
-- Name: work_log_endorsements fk_work_log_endorsements_actor_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_endorsements
    ADD CONSTRAINT fk_work_log_endorsements_actor_id_users FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: work_log_endorsements fk_work_log_endorsements_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_endorsements
    ADD CONSTRAINT fk_work_log_endorsements_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id);


--
-- Name: work_log_entries fk_work_log_entries_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_entries
    ADD CONSTRAINT fk_work_log_entries_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id) ON DELETE CASCADE;


--
-- Name: work_log_measures fk_work_log_measures_entry_id_work_log_entries; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_measures
    ADD CONSTRAINT fk_work_log_measures_entry_id_work_log_entries FOREIGN KEY (entry_id) REFERENCES public.work_log_entries(id) ON DELETE CASCADE;


--
-- Name: work_log_versions fk_work_log_versions_created_by_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_versions
    ADD CONSTRAINT fk_work_log_versions_created_by_users FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: work_log_versions fk_work_log_versions_work_log_id_work_logs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_log_versions
    ADD CONSTRAINT fk_work_log_versions_work_log_id_work_logs FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id);


--
-- Name: work_logs fk_work_logs_assignment_id_staff_assignments; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT fk_work_logs_assignment_id_staff_assignments FOREIGN KEY (assignment_id) REFERENCES public.staff_assignments(id);


--
-- Name: work_logs fk_work_logs_cadre_id_cadres; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT fk_work_logs_cadre_id_cadres FOREIGN KEY (cadre_id) REFERENCES public.cadres(id);


--
-- Name: work_logs fk_work_logs_period_id_pay_periods; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT fk_work_logs_period_id_pay_periods FOREIGN KEY (period_id) REFERENCES public.pay_periods(id);


--
-- Name: work_logs fk_work_logs_section_sections; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT fk_work_logs_section_sections FOREIGN KEY (section) REFERENCES public.sections(code);


--
-- Name: work_logs fk_work_logs_staff_id_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT fk_work_logs_staff_id_staff FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- PostgreSQL database dump complete
--



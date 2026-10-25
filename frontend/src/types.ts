/** Shapes returned by the HRH backend (FastAPI). Decimals arrive as JSON numbers; dates as ISO strings. */

export type Lang = 'en' | 'sw';

export interface CadreField {
  key: string;
  label_en: string;
  label_sw: string | null;
  field_type: 'INTEGER' | 'BOOLEAN';
}

export interface CadreActivity {
  key: string;
  label_en: string;
  label_sw: string;
  fields: string[];
  required_fields: string[];
  groups?: {
    key: string;
    label_en: string;
    label_sw: string;
    color: string;
    fields: string[];
  }[];
  form_mode?: 'CASCADE' | 'SINGLE';
  hours_input?: boolean;
  item_type?: 'SERVICES' | 'PAYROLL';
  requires_location?: boolean;
  effective_start_date?: string | null;
  /** Exclusive upper bound: this activity is not available on the end date. */
  effective_end_date?: string | null;
}

export interface Cadre {
  id: number;
  code: string;
  name: string;
  form_title: string | null;
  hours_mode: 'DIRECT' | 'START_END';
  uses_facility_geofence: boolean;
  requires_facility_endorsement: boolean;
  /** FHI360 position that gives technical endorsement for this cadre's logs */
  technical_reviewer_title: string | null;
  uses_section: boolean;
  occupation_options: string[];
  fields: CadreField[];
  activities: CadreActivity[];
}

export interface UserScope {
  id?: number;
  user_id?: number;
  region_id: number | null;
  cluster_id: number | null;
  facility_id: number | null;
  community_area_id: number | null;
  organization_id: number | null;
}

export interface Me {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_language: Lang;
  is_active: boolean;
  /** Set after an administrator issues a temporary password; nothing else works until it is changed. */
  must_change_password: boolean;
  roles: string[];
  staff: { id: number; legal_name: string; cadre_id: number; status: string; occupation: string | null } | null;
  cadre: Cadre | null;
  organizations: { id: number; name: string; type: string }[];
  scopes: UserScope[];
  client_settings: { gps_capture_events: string[]; otp_length: number; provider_otp_required: boolean; gps_required_on_submit: boolean };
}

export interface PayPeriod {
  id: number;
  start_date: string;
  end_date: string;
  period_label: string | null;
  status: string;
  region_id?: number | null;
  region_name?: string | null;
  can_manage?: boolean;
}

export interface ProviderPaymentDetails {
  staff_id: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_branch: string | null;
  mobile_money_number: string | null;
}

export interface CsoFinanceOrganization {
  id: number;
  name: string;
}

export interface Section {
  code: string;
  name: string;
}

// ---- Work logs -------------------------------------------------------------------------

export interface WorkLogSummary {
  id: number;
  staff_id: number;
  period_id: number;
  assignment_id: number;
  cadre_id: number;
  occupation: string | null;
  occupation_other: string | null;
  section: string | null;
  status: string;
  workflow_version: number;
  work_type: 'LEGACY' | 'SERVICES' | 'PAYROLL';
  finance_snapshot: Record<string, unknown> | null;
  routed_channel: 'FHI360' | 'CSO' | null;
  version: number;
  confirmed_version: number | null;
  period_comment: string | null;
  attested_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
  staff_name: string;
  cadre_code: string;
  facility_name: string | null;
  period_label: string;
  entry_count: number;
  total_hours: number;
  hours_in_status: number;
  reminder_after_hours: number;
  is_overdue: boolean;
}

export interface RoutingPayor {
  id: number;
  name: string;
  type: string;
}

export interface RoutingQueueItem {
  work_log_id: number;
  claim_id: number | null;
  workflow_version: 2;
  work_type: 'SERVICES' | 'PAYROLL';
  provider_name: string;
  cadre_id: number;
  cadre_code: string;
  cadre_name: string;
  facility_id: number | null;
  facility_name: string | null;
  region_id: number;
  region_name: string;
  period_label: string;
  status: string;
  next_action?: 'REVIEW_AMOUNT' | 'CHANNEL' | 'RESOLVE_BUDGET_HOLD';
  finance_review_required?: boolean;
  amount: string | null;
  currency: string | null;
  eligible_payors: RoutingPayor[];
  routing_exception: string | null;
}

export interface FinancePayorsResponse {
  work_log_id: number;
  eligible_payors: RoutingPayor[];
  routing_exception: string | null;
}

export interface ChannelResponse {
  work_log_id: number;
  claim_id: number;
  status: string;
  claim_status: string;
  payor_id: number;
  payor_name: string;
  channel: string;
  amount: string;
  currency: string;
}

export interface WorkLogEntry {
  id: number;
  entry_date: string;
  activity_key: string | null;
  activity_location: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number;
  evidence_text: string;
  comment: string | null;
  gps_lat?: number | null;
  gps_lon?: number | null;
  gps_accuracy_m?: number | null;
  gps_captured_at: string | null;
  location_status: string;
  measures: Record<string, number>;
  location_exception: boolean;
}

export interface ReturnFlag {
  entry_date: string;
  field: string;
  note: string;
}

export interface WorkLogAudit {
  id: number;
  version: number;
  actor_id: number | null;
  actor_role: string | null;
  action: string;
  old_status: string | null;
  new_status: string | null;
  comment: string | null;
  details: { flags?: ReturnFlag[]; [key: string]: unknown } | null;
  timestamp: string;
  actor_name: string | null;
}

export interface Assignment {
  id: number;
  region_id?: number | null;
  district_id?: number | null;
  ward_id?: number | null;
  facility_id?: number | null;
  community_area_id?: number | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  facility: string | null;
  community_area: string | null;
  section: string | null;
  organization_id: number | null;
  start_date: string;
  end_date: string | null;
  end_reason?: string | null;
  is_primary?: boolean;
}

export interface WorkLogDetail extends WorkLogSummary {
  backdate_access?: {
    grace_hours: number;
    grants: { entry_date: string; expires_at: string }[];
  };
  staff: { id: number; name: string; first_name: string; middle_name: string | null; last_name: string; salary_scale: string | null };
  cadre: Cadre;
  assignment: Assignment | null;
  period: PayPeriod;
  entries: WorkLogEntry[];
  totals: { days: number; hours: number; measures: Record<string, number> };
  review_summary: {
    metrics: Record<string, string>;
    months: { month: string; days: number; hours: string; metrics: Record<string, string> }[];
    anomalies: { date: string | null; code: string; message: string }[];
    limits: { daily_hours: string; weekly_hours: string; saturday_min_hours: string; saturday_max_hours: string; sunday_allowed: boolean; backdate_grace_hours: number };
  };
  financial_preview?: {
    lines: { entry_id: number; date: string; activity: string; units: string; rate: string | null; amount: string | null; currency: string | null }[];
    total: string;
    currency: string | null;
    exceptions: string[];
  } | null;
  location_exception_count: number;
  gps_visible: boolean;
  audit: WorkLogAudit[];
  endorsements: { id: number; version: number; kind: string; actor_name: string; comment: string | null; created_at?: string }[];
  versions: { version: number; created_at: string }[];
  available_actions: string[];
  can_edit: boolean;
  awaiting_my_otp: boolean;
  /** Development only (mock SMS): the code just sent to the provider. */
  dev_otp?: string | null;
  claims: {
    id: number;
    status: string;
    payment_status: string;
    amount?: number | string | null;
    currency?: string | null;
    category_id?: number | null;
    category_name?: string | null;
  }[];
  otp?: { sms_status: string; dev_otp?: string } | null;
}

export interface WorkLogSnapshot {
  version: number;
  created_at: string;
  snapshot: {
    staff: { name: string; salary_scale: string | null };
    cadre: string;
    occupation: string | null;
    occupation_other: string | null;
    section: string | null;
    period: { start: string; end: string; label: string | null };
    period_comment: string | null;
    entries: {
      date: string;
      activity_key: string | null;
      activity_location: string | null;
      start_time: string | null;
      end_time: string | null;
      hours: string;
      evidence: string;
      comment: string | null;
      location_status: string;
      measures: Record<string, string>;
    }[];
    totals: { days: string; hours: string; measures: Record<string, string> };
  };
}

// ---- Claims ----------------------------------------------------------------------------

export interface ClaimSummary {
  id: number;
  work_log_id: number | null;
  staff_id: number;
  category_id: number | null;
  period_id: number;
  route_code: string | null;
  payor_org_id: number | null;
  executor_org_id: number | null;
  budget_line_id: number | null;
  origin_channel: string | null;
  evidence_text: string | null;
  description?: string | null;
  declared_units: Record<string, number> | null;
  amount: number;
  currency: string;
  status: string;
  payment_status: string;
  exception_reason: string | null;
  batch_id: number | null;
  created_by: number;
  verified_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  staff_name: string;
  category_name: string | null;
  period_label: string;
  payor_name: string | null;
  executor_name: string | null;
  batch_reference: string | null;
  amount_paid: number;
  /** Present for claims generated from the versioned work-log workflow. */
  workflow_version?: number | null;
  work_type?: 'LEGACY' | 'SERVICES' | 'PAYROLL' | 'COMMUNITY' | null;
}

export interface ClaimComponent {
  id?: number;
  rate_rule_id: number | null;
  component_name: string;
  unit_type: string | null;
  measure_key: string | null;
  units: number;
  rate: number;
  amount: number;
  cap_amount?: number | null;
  currency?: string;
}

export interface PaymentRecord {
  id: number;
  payment_reference: string;
  payment_method: string | null;
  amount: number;
  payment_date: string;
  status: string;
  recorded_by: number;
  created_at?: string;
}

export interface PaymentProof {
  id: number;
  payment_record_id: number | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by: number;
  created_at?: string;
}

export interface ClaimAudit {
  id: number;
  actor_role: string | null;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_payment_status: string | null;
  new_payment_status: string | null;
  comment: string | null;
  details: Record<string, unknown> | null;
  timestamp: string;
  actor_name: string | null;
}

export interface ClaimDetail extends ClaimSummary {
  calculation_snapshot: {
    route: string | null;
    components: ClaimComponent[];
    amount: number;
    authorized_at: string;
  } | null;
  budget_line: {
    id: number;
    code: string;
    name: string;
    estimated_amount?: number | null;
    committed_amount?: number;
    spent_amount?: number;
    allocated_amount?: number;
  } | null;
  components: ClaimComponent[];
  payments: PaymentRecord[];
  proofs: PaymentProof[];
  audit: ClaimAudit[];
  available_actions: string[];
  payment_actions: string[];
  payment_recipient?: { name: string; payment_method: string | null; payment_provider: string | null; payment_account: string | null; bank_branch?: string | null } | null;
}

export interface CommunityClaimOptions {
  periods: PayPeriod[];
  categories: { id: number; name: string; unit_fields: { key: string; label: string; unit_type: string }[]; configuration_error: string | null }[];
}

export interface CommunityClaimPreview {
  amount: number;
  currency: string;
  components: ClaimComponent[];
  payor_name: string | null;
  region_name: string | null;
  budget_line_id: number | null;
}

export interface ClaimPreview {
  route_code: string | null;
  payor_name: string | null;
  executor_name: string | null;
  budget_line_id: number | null;
  components: ClaimComponent[];
  amount: number;
  exceptions: string[];
}

export interface EligibleWorkLog {
  id: number;
  staff_name: string;
  period_label: string;
  approved_at: string | null;
  claimed_category_ids: number[];
}

export interface ClaimCategory {
  id: number;
  name: string;
  form_type: string | null;
  route_id: number | null;
  funding_source_id: number | null;
  payor_org_id: number | null;
  budget_owner: string;
  origin_channel: string;
  budget_line_code: string | null;
  requires_work_log: boolean;
  is_active: boolean;
}

export interface RateRule {
  id: number;
  category_id: number;
  cadre_id: number | null;
  region_id: number | null;
  component_name: string;
  unit_type: 'PER_DAY' | 'PER_HOUR' | 'PER_UNIT' | 'FIXED';
  measure_key: string | null;
  rate_value: number;
  currency: string;
  cap_amount: number | null;
  effective_start_date: string;
  effective_end_date: string | null;
  status: string;
  created_by: number;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
}

export interface RateActivity {
  id: number;
  key: string;
  label_en: string;
  label_sw: string;
  cadre_id: number;
  region_id: number | null;
  item_type: 'SERVICES' | 'PAYROLL';
  form_mode: 'CASCADE' | 'SINGLE';
  fields: string[];
  required_fields: string[];
  field_definitions: CadreField[];
  hours_input: boolean;
  rate_value: number;
  currency: string;
  unit_type: 'PER_UNIT' | 'PER_HOUR' | 'PER_DAY';
  billable_field: string | null;
  is_active: boolean;
  effective_start_date: string;
}

export interface RateTemplates {
  cadres: { id: number; code: string; name: string }[];
  regions: Named[];
  templates: { key: string; label_en: string; label_sw: string; cadre_id: number; form_mode: 'CASCADE' | 'SINGLE'; item_type: 'SERVICES' | 'PAYROLL'; field_definitions?: CadreField[] }[];
}

// ---- Batches ---------------------------------------------------------------------------

export interface Batch {
  id: number;
  reference: string;
  route_code: string;
  payor_org_id: number | null;
  executor_org_id: number;
  status: string;
  line_count: number;
  total_amount: number;
  currency: string;
  created_by: number;
  created_at: string;
  handed_off_at: string | null;
  received_at: string | null;
  payor_name: string | null;
  executor_name: string | null;
  created_by_name: string | null;
  payment_progress: Record<string, number>;
  can_hand_off: boolean;
  can_receive: boolean;
}

export interface BatchLine {
  batch: string;
  claim_id: number;
  staff_id: number;
  staff_name: string;
  phone: string;
  cadre: string;
  facility: string;
  region: string;
  period: string;
  category: string;
  budget_line: string;
  route: string;
  payor: string;
  executor: string;
  payment_method: string;
  payment_provider: string;
  payment_account?: string;
  components: string;
  amount: string;
  currency: string;
}

export interface BatchDetail extends Batch {
  lines: BatchLine[];
  claims: { id: number; status: string; payment_status: string }[];
}

// ---- Budgets ---------------------------------------------------------------------------

export interface BudgetLine {
  id: number;
  code: string;
  name: string;
  source: string;
  organization_id: number;
  category_id: number;
  activity_type?: 'SERVICES' | 'PAYROLL' | null;
  period_id: number;
  region_id: number | null;
  /** Null means no historical estimate was recorded; do not treat it as zero. */
  estimated_amount: number | null;
  exposure_amount: number;
  estimate_warning: boolean;
  budget_status: 'NOT_SET' | 'WITHIN_ESTIMATE' | 'ESTIMATE_REACHED' | 'HARD_CAP_REACHED';
  allocated_amount: number;
  committed_amount: number;
  spent_amount: number;
  available_amount: number;
  currency: string;
  sync_status: string;
  external_ref: string | null;
  last_synced_at: string | null;
  organization_name: string;
  category_name: string;
  period_label: string;
  region_name: string;
}

export interface BudgetTransaction {
  id: number;
  kind: string;
  amount: number;
  claim_id: number | null;
  payment_record_id: number | null;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface BudgetSyncLog {
  id: number;
  sync_type: string;
  filename: string | null;
  records_processed: number;
  success_count: number;
  error_count: number;
  sync_status: string;
  log_data: { errors?: { line: number; error: string }[]; [key: string]: unknown } | null;
  performed_by: number;
  started_at: string;
  completed_at: string | null;
}

// ---- Staff -----------------------------------------------------------------------------

export interface StaffSummary {
  id: number;
  legal_name: string;
  cadre: string;
  occupation: string | null;
  status: string;
  phone: string;
  has_login: boolean;
  enrollment_source: string;
  current_assignment: Assignment | null;
}

export interface StaffDetail {
  id: number;
  user_id: number | null;
  cadre_id: number;
  cadre: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  legal_name: string;
  verified_phone: string;
  occupation: string | null;
  occupation_other: string | null;
  salary_scale: string | null;
  status: string;
  employment_start_date: string | null;
  employment_end_date: string | null;
  enrollment_source: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_account?: string | null;
  /** Present only when the requesting role may view payroll bank details. */
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_branch?: string | null;
  /** Present only when the requesting role may view mobile-money details. */
  mobile_money_number?: string | null;
  assignments: Assignment[];
  username: string | null;
}

export interface ChangeRequest {
  id: number;
  staff_id: number;
  staff_name: string;
  changes: Record<string, unknown>;
  reason: string;
  status: string;
  requested_by: number;
  requested_by_name: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
}

export interface RosterImport {
  id: number;
  filename: string;
  enrollment_source: string;
  total_rows: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  errors: { line: number; error: string }[] | null;
  created_at: string;
}

// ---- Admin -----------------------------------------------------------------------------

export interface Named {
  id: number;
  name: string;
}

export interface Organization extends Named {
  code: string | null;
  type: string;
  is_active: boolean;
}

export interface OrganizationAssignment {
  id: number;
  organization_id: number;
  region_id: number;
  is_active: boolean;
  organization_name: string;
  region_name: string;
}

export interface OrganizationsResponse {
  organizations: Organization[];
  regions: Named[];
  assignments: OrganizationAssignment[];
  can_manage: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_language: Lang;
  is_active: boolean;
  is_locked: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  roles: string[];
  scopes: UserScope[];
  /** Technical officers: the cadres whose logs they review */
  review_cadre_ids: number[];
  staff_id: number | null;
}

export interface RoleInfo {
  name: string;
  description: string;
}

export interface Setting {
  key: string;
  value: unknown;
  default: unknown;
  description: string | null;
}

export interface SmsTemplate {
  event_name: string;
  language: Lang;
  recipient: string;
  variables: string[];
  protected: boolean;
  active_text: string | null;
  active_version: number | null;
  versions: { version: number; text: string; created_at: string; is_active: boolean }[];
}

export interface SmsOutboxRow {
  id: number;
  event_name: string;
  destination_phone: string;
  language: string | null;
  message_body: string;
  status: string;
  attempts: number;
  last_error: string | null;
  related_type: string | null;
  related_id: number | null;
  related_status: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface AuditEvent {
  id: number;
  actor_id: number | null;
  actor_roles: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

// ---- Dashboard -------------------------------------------------------------------------

export interface DashboardData {
  staff: { total: number; active: number; exited: number; mid_period_exits: number; rotations_in_period: number };
  work_logs: {
    by_status: Record<string, number>;
    reminder_after_hours: number;
    queues: { status: string; owner: string; count: number; max_age_hours: number; avg_age_hours: number; over_48h: number; over_threshold: number }[];
    completeness: { active_staff: number; with_log: number; missing: number | null };
    exceptions: Record<string, number>;
  };
  claims: Record<
    string,
    {
      count: number;
      by_status: Record<string, { count: number; amount: number }>;
      by_payment_status: Record<string, { count: number; amount: number }>;
    }
  >;
  budgets:
    | {
        allocated: number;
        committed: number;
        spent: number;
        remaining: number;
        lines: number;
        claims_on_hold: number;
        unsynced_tracker_lines: number;
      }
    | never[];
}

/** Estimated payout for a work log, from active approved rate rules. Not an approved amount. */
export interface PayoutEstimateData {
  lines: { category: string; component: string; units: string | number; rate: string | number; amount: string | number; currency: string }[];
  totals: { currency: string; amount: string | number }[];
}

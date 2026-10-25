export interface DemoWorkflowResponse {
  schema_version: 1;
  generated_at: string;
  simulated: boolean;
  summary: { scenario_count: number; provider_count: number; step_count: number };
  checks: { label: string; passed: boolean; detail: string }[];
  scenarios: DemoScenario[];
}

export interface DemoScenario {
  id: string;
  title: string;
  region: string;
  cadre: string;
  work_type: string;
  route: string;
  variant: string;
  provider_label: string;
  description: string;
  steps: DemoStep[];
}

export interface DemoStep {
  id: string;
  title: string;
  role: string;
  actor: string;
  action: string;
  explanation: string;
  expected: string;
  work_log: null | {
    id: number;
    status: string;
    work_type: string;
    period_label: string;
    total_hours: number;
    entry_count: number;
    available_actions: string[];
    entries: { date: string; activity: string; hours: number; measures: Record<string, number> }[];
    financial_total: string | null;
    currency: string | null;
  };
  claim: null | {
    id: number;
    status: string;
    payment_status: string;
    amount: string;
    currency: string;
    amount_paid: string;
    category_name: string | null;
    payor_name: string | null;
    executor_name: string | null;
    budget_line: string | null;
    proof_count: number;
    available_actions: string[];
    payment_actions: string[];
    components: { name: string; units: string; rate: string; amount: string }[];
    audit: { action: string; role: string; status: string }[];
  };
  batch: null | {
    reference: string;
    status: string;
    line_count: number;
    total_amount: string;
    currency: string;
    payor_name: string | null;
    executor_name: string | null;
  };
}

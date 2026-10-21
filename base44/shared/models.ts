// Shared record and entity-client types for the billing / usage code.
//
// The store is schemaless, so the entity client is modelled with a permissive
// row type: fields the billing logic depends on are named explicitly on each
// record interface, while undeclared fields stay readable (mirroring the store).
// This is a deliberate boundary model, not a way to silence diagnostics — every
// function that consumes these types still has fully checked parameters.

export type Iso = string;

/** A dynamic database row. Declared per-record interfaces narrow the fields the
 *  billing logic reads; anything else on the row remains readable. */
export type Row = Record<string, any>;

export interface ListOptions {
  sort?: string;
  limit?: number;
  cursor?: string | null;
  distinct?: string;
}

export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export interface UpdateResult {
  updated?: number;
}

export interface EntityRepo<T extends Row = Row> {
  filter(query?: Row, options?: ListOptions): Promise<T[] | Page<T>>;
  list(options?: ListOptions): Promise<T[] | Page<T>>;
  get(id: string): Promise<T>;
  count(query?: Row): Promise<number>;
  create(data: Row): Promise<T>;
  update(id: string, data: Row): Promise<T>;
  updateMany(query: Row, update: Row): Promise<UpdateResult>;
  delete(id: string): Promise<unknown>;
  deleteMany(query: Row): Promise<unknown>;
  upsert(rows: Row[], options?: Row): Promise<unknown>;
}

export type BillingStatus =
  | "trial"
  | "paid"
  | "payment_grace"
  | "read_only"
  | "legacy_access"
  | "canceled";

export interface WorkspaceBillingRecord extends Row {
  id: string;
  workspace_id: string;
  environment: string;
  status?: BillingStatus | string;
  plan?: "starter" | "growth" | string | null;
  interval?: "month" | "year" | string | null;
  trial_started_at?: Iso | null;
  trial_ends_at?: Iso | null;
  paid_window_anchor?: Iso | null;
  paid_through?: Iso | null;
  enforcement_enabled?: boolean;
  legacy_access?: boolean;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_status?: string | null;
  catalog_version?: string | null;
}

export interface UsageWindowRecord extends Row {
  id: string;
  workspace_id: string;
  metric: string;
  window_start: Iso;
  window_end: Iso;
  allowance?: number | null;
  used?: number | null;
  reserved?: number | null;
}

export type UsageOperationState = "reserved" | "consumed" | "released" | "failed";

export interface UsageOperationRecord extends Row {
  id: string;
  workspace_id: string;
  operation_key: string;
  metric: string;
  units?: number | null;
  state: UsageOperationState;
  window_id?: string | null;
  source_ref?: string | null;
  payload_fingerprint?: string | null;
}

export interface ServiceRoleEntities {
  WorkspaceBilling: EntityRepo<WorkspaceBillingRecord>;
  UsageWindow: EntityRepo<UsageWindowRecord>;
  UsageOperation: EntityRepo<UsageOperationRecord>;
  [entity: string]: EntityRepo;
}

export interface CoreIntegrations {
  InvokeLLM(args: Row): Promise<Row | string>;
  GenerateImage(args: Row): Promise<{ url?: string }>;
  SendEmail(args: Row): Promise<Row>;
  [method: string]: (args: Row) => Promise<unknown>;
}

/** Minimal service-role client surface the shared modules use. */
export interface ServiceRoleClient {
  entities: ServiceRoleEntities;
  integrations: { Core: CoreIntegrations };
}
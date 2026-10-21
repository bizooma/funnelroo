// Ambient declarations for the Deno-only module specifiers used by the backend
// functions and shared modules. TypeScript cannot resolve `npm:` / `base44:`
// specifiers, so the surface this codebase actually uses is declared here with
// real parameter and return types (no bare `any`). These describe the runtime
// contracts the code depends on, which is what makes the backend type check
// meaningful instead of being switched off.

declare module "base44:runtime" {
  export const secrets: {
    get(name: string): string | undefined;
    set?(name: string, value: string): void;
  };
}

declare module "npm:stripe@17.7.0" {
  export interface StripeAccount {
    id?: string;
    country?: string;
    email?: string;
  }

  export interface StripeList<T> {
    data: T[];
    has_more?: boolean;
  }

  export interface StripePrice {
    id: string;
    object?: string;
    active?: boolean;
    currency?: string;
    unit_amount?: number | null;
    lookup_key?: string | null;
    product?: string;
    recurring?: { interval?: string; usage_type?: string } | null;
    metadata?: Record<string, string>;
  }

  export interface StripeProduct {
    id: string;
    name?: string;
  }

  export interface StripeCustomer {
    id: string;
    deleted?: boolean;
    email?: string | null;
  }

  export interface StripeSubscriptionItem {
    id: string;
    current_period_start?: number;
    current_period_end?: number;
    price?: StripePrice;
  }

  export interface StripeSubscription {
    id: string;
    status: string;
    customer?: string | StripeCustomer;
    metadata?: Record<string, string> | null;
    cancel_at_period_end?: boolean;
    canceled_at?: number | null;
    current_period_start?: number;
    current_period_end?: number;
    items?: { data: StripeSubscriptionItem[] };
  }

  export interface StripeCheckoutSession {
    id: string;
    object?: string;
    url?: string | null;
    status?: string | null;
    payment_status?: string | null;
    subscription?: string | StripeSubscription | null;
    subscription_id?: string | null;
    client_reference_id?: string | null;
    metadata?: Record<string, string> | null;
  }

  export interface StripeEvent {
    id: string;
    type: string;
    // The API version Stripe stamped on this event.
    api_version?: string;
    data: { object: Record<string, any> };
  }

  export interface StripeRequestConfig {
    maxNetworkRetries?: number;
    appInfo?: { name?: string; version?: string };
    apiVersion?: string;
    timeout?: number;
  }

  export interface StripeClient {
    accounts: { retrieve(): Promise<StripeAccount> };
    customers: {
      create(params: Record<string, unknown>): Promise<StripeCustomer>;
      retrieve(id: string): Promise<StripeCustomer>;
    };
    products: {
      create(params: Record<string, unknown>): Promise<StripeProduct>;
      retrieve(id: string): Promise<StripeProduct>;
    };
    prices: {
      list(params: Record<string, unknown>): Promise<StripeList<StripePrice>>;
      create(params: Record<string, unknown>): Promise<StripePrice>;
    };
    subscriptions: {
      retrieve(id: string): Promise<StripeSubscription>;
      update(id: string, params: Record<string, unknown>): Promise<StripeSubscription>;
    };
    checkout: {
      sessions: {
        create(params: Record<string, unknown>): Promise<StripeCheckoutSession>;
        retrieve(id: string, options?: Record<string, unknown>): Promise<StripeCheckoutSession>;
      };
    };
    billingPortal: {
      sessions: { create(params: Record<string, unknown>): Promise<{ url: string }> };
    };
    webhooks: {
      constructEventAsync(
        payload: string,
        signature: string,
        secret: string
      ): Promise<StripeEvent>;
    };
  }

  export interface StripeConstructor {
    new (key: string, config?: StripeRequestConfig): StripeClient;
    /** The API version this SDK requests and expects on events. */
    ApiVersion?: string;
  }

  const Stripe: StripeConstructor;
  export default Stripe;
}

declare module "npm:@base44/sdk@0.8.52" {
  import type { ServiceRoleClient, Row } from "./models.ts";

  export interface SdkUser {
    id: string;
    email?: string;
    full_name?: string;
    role?: string;
  }

  export interface SdkClient {
    auth: {
      me(): Promise<SdkUser | null>;
      updateMe(data: Record<string, unknown>): Promise<SdkUser>;
      logout(redirectUrl?: string): void;
    };
    asServiceRole: ServiceRoleClient;
    functions: { invoke(name: string, payload: Row): Promise<{ data: Row }> };
  }

  export function createClientFromRequest(req: Request): SdkClient;
}
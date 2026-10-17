// Shared template-aware readiness evaluator for FunnelRoo.
// Used by the dashboard, guided setup, funnel Plan tab, Roo's next-action
// guidance, and the publish endpoint so they all use ONE model.
//
// Three categories:
//   preparation     — is the selected marketing context ready for tailored drafting?
//   launch_required — can the chosen visitor journey fulfill its promises?
//   optional        — features the customer has not enabled or does not need
//
// Each item: { id, status, reason, action, required, classification }
//   status: "ready" | "needs_review" | "missing" | "not_started" | "not_needed"
//   classification: "preparation" | "launch_required" | "optional"

// ---- Types ----

type FunnelType = "lead_magnet" | "direct_booking" | "service_inquiry";
type ReadinessStatus = "ready" | "needs_review" | "missing" | "not_started" | "not_needed";
type ReadinessClassification = "preparation" | "launch_required" | "optional";

interface ReadinessFunnel {
  id?: string;
  type?: FunnelType;
  audience_id?: string;
  offer_id?: string;
}

interface PageBlock {
  type: string;
  props?: Record<string, unknown>;
}

interface ReadinessDraft {
  page_blocks?: PageBlock[];
  booking_event_type_id?: string;
  resource_version_id?: string;
  delivery_mode?: "immediate_only" | "immediate_plus_email";
  sender_id?: string;
  sequence_ref?: string;
  consent_text?: string;
}

interface ReadinessItem {
  id: string;
  status: ReadinessStatus;
  reason: string;
  action: string;
  required: boolean;
  classification: ReadinessClassification;
}

interface ReadinessResult {
  preparation: ReadinessItem[];
  launch_required: ReadinessItem[];
  optional: ReadinessItem[];
  canPublish: boolean;
  launchBlocked: boolean;
  optionalBlocked: boolean;
  preparationReady: boolean;
}

interface DashboardProfile {
  business_name?: string;
  primary_service?: string;
}

interface DashboardAudience {
  status?: "draft" | "ready" | "archived";
  approved?: boolean;
}

interface DashboardOffer {
  status?: "draft" | "ready" | "archived";
  approved?: boolean;
}

interface DashboardFunnel {
  id: string;
  name: string;
  state: "draft" | "published" | "paused" | "archived";
}

interface DashboardSetupSession {
  id: string;
  funnel_name?: string;
  step?: string;
  completed?: boolean;
  abandoned?: boolean;
}

interface DashboardState {
  profile?: DashboardProfile;
  audiences?: DashboardAudience[];
  offers?: DashboardOffer[];
  funnels?: DashboardFunnel[];
  setupSessions?: DashboardSetupSession[];
}

interface DashboardNextAction {
  label: string;
  destination: string;
}

interface DashboardActionResult {
  mode: "operational" | "launch_guide";
  heading: string | null;
  subheading: string | null;
  nextAction: DashboardNextAction | null;
  progress: { stage: string };
}

// ---- Functions ----

export function evaluateReadiness(funnel: ReadinessFunnel, draft: ReadinessDraft, opts?: Record<string, unknown>): ReadinessResult {
  const type = funnel?.type || "lead_magnet";
  const blocks = draft?.page_blocks || [];
  const hasForm = blocks.some((b: PageBlock) => b.type === "form");
  const hasHero = blocks.some((b: PageBlock) => b.type === "hero");
  const hasBookingBlock = blocks.some((b: PageBlock) => b.type === "booking" && b.props?.calendly_url);
  const hasBookingEventType = !!draft?.booking_event_type_id;
  const hasResourceVersion = !!draft?.resource_version_id;
  const deliveryMode = draft?.delivery_mode || "immediate_only";
  const hasSender = deliveryMode === "immediate_plus_email" && !!draft?.sender_id;
  const hasSequence = !!draft?.sequence_ref;
  const hasAudience = !!funnel?.audience_id;
  const hasOffer = !!funnel?.offer_id;
  const hasConsent = !!draft?.consent_text;
  const funnelId = funnel?.id || "";
  const action = (path: string) => funnelId ? `/funnels/${funnelId}` : "/funnels";

  const preparation: ReadinessItem[] = [];
  const launchRequired: ReadinessItem[] = [];
  const optional: ReadinessItem[] = [];

  // ---- PREPARATION ----
  preparation.push({
    id: "audience",
    status: hasAudience ? "ready" : "not_started",
    reason: hasAudience ? "Audience selected" : "Choose who this funnel is for so Roo can tailor the message.",
    action: hasAudience ? action(funnelId) : "/marketing-kit",
    required: false,
    classification: "preparation",
  });
  preparation.push({
    id: "offer",
    status: hasOffer ? "ready" : "not_started",
    reason: hasOffer ? "Offer selected" : "Choose what you are promoting.",
    action: hasOffer ? action(funnelId) : "/marketing-kit",
    required: false,
    classification: "preparation",
  });

  // ---- LAUNCH REQUIRED (template-specific) ----
  // Landing page sections
  launchRequired.push({
    id: "page_sections",
    status: blocks.length >= 2 ? "ready" : "missing",
    reason: blocks.length >= 2 ? "Landing page has content" : "Add at least a hero and one more section.",
    action: action(funnelId),
    required: true,
    classification: "launch_required",
  });

  if (type === "lead_magnet") {
    // Lead magnet: form + real approved resource version + delivery
    launchRequired.push({
      id: "lead_form",
      status: hasForm ? "ready" : "missing",
      reason: hasForm ? "Request form is on the page" : "Add a request form so visitors can ask for the resource.",
      action: action(funnelId),
      required: true,
      classification: "launch_required",
    });
    launchRequired.push({
      id: "resource_version",
      status: hasResourceVersion ? "ready" : "missing",
      reason: hasResourceVersion ? "Approved resource version attached" : "Choose the file visitors will receive.",
      action: `${action(funnelId)}?tab=resource`,
      required: true,
      classification: "launch_required",
    });
    // Email delivery is conditional on delivery mode
    if (deliveryMode === "immediate_plus_email") {
      launchRequired.push({
        id: "sender",
        status: hasSender ? "ready" : "missing",
        reason: hasSender ? "Sender configured" : "Select a verified sender for email delivery.",
        action: `${action(funnelId)}?tab=resource`,
        required: true,
        classification: "launch_required",
      });
    }
  }

  if (type === "direct_booking") {
    // Direct booking: offer page + working scheduling destination
    launchRequired.push({
      id: "booking_destination",
      status: hasBookingEventType || hasBookingBlock ? "ready" : "missing",
      reason: hasBookingEventType
        ? "Booking event type connected"
        : hasBookingBlock
        ? "Booking link added"
        : "Add your booking link or connect Calendly.",
      action: `${action(funnelId)}?tab=booking`,
      required: true,
      classification: "launch_required",
    });
  }

  if (type === "service_inquiry") {
    // Service inquiry: page + inquiry form + receipt
    launchRequired.push({
      id: "inquiry_form",
      status: hasForm ? "ready" : "missing",
      reason: hasForm ? "Inquiry form is on the page" : "Add an inquiry form so visitors can reach you.",
      action: action(funnelId),
      required: true,
      classification: "launch_required",
    });
  }

  // ---- OPTIONAL ----
  // Booking on lead_magnet (optional unless promised)
  if (type === "lead_magnet") {
    optional.push({
      id: "booking",
      status: hasBookingEventType || hasBookingBlock ? "ready" : "not_needed",
      reason: hasBookingEventType || hasBookingBlock
        ? "Booking invitation is on the page"
        : "Optional: add a booking invitation for the next step.",
      action: `${action(funnelId)}?tab=booking`,
      required: false,
      classification: "optional",
    });
  }

  // Nurture / follow-up (optional unless enabled)
  if (hasSequence) {
    // If a sequence is linked, consent is required
    optional.push({
      id: "nurture_consent",
      status: hasConsent ? "ready" : "missing",
      reason: hasConsent ? "Consent text configured" : "Add consent text for follow-up emails.",
      action: `${action(funnelId)}?tab=followup`,
      required: true, // required BECAUSE the feature was enabled
      classification: "optional",
    });
  } else {
    optional.push({
      id: "nurture",
      status: "not_needed",
      reason: "Optional: add a follow-up email sequence.",
      action: `${action(funnelId)}?tab=followup`,
      required: false,
      classification: "optional",
    });
  }

  // ---- Summary ----
  const launchBlocked = launchRequired.some((r) => r.required && r.status !== "ready");
  const optionalBlocked = optional.some((r) => r.required && r.status !== "ready");
  const canPublish = !launchBlocked && !optionalBlocked;
  const preparationReady = preparation.every((r) => r.status === "ready");

  return {
    preparation,
    launch_required: launchRequired,
    optional,
    canPublish,
    launchBlocked,
    optionalBlocked,
    preparationReady,
  };
}

// Determine the next useful action for the dashboard based on actual saved state.
// Returns { heading, subheading, action_label, action_destination, progress }
export function nextDashboardAction(state: DashboardState): DashboardActionResult {
  const { profile, audiences, offers, funnels, setupSessions } = state;

  const hasBusinessBasics = !!(profile?.business_name || profile?.primary_service);
  const readyAudiences = (audiences || []).filter((a: DashboardAudience) => a.status === "ready" || a.approved);
  const draftAudiences = (audiences || []).filter((a: DashboardAudience) => a.status === "draft" && !a.approved);
  const readyOffers = (offers || []).filter((o: DashboardOffer) => o.status === "ready" || o.approved);
  const draftOffers = (offers || []).filter((o: DashboardOffer) => o.status === "draft" && !o.approved);
  const publishedFunnels = (funnels || []).filter((f: DashboardFunnel) => f.state === "published");
  const draftFunnels = (funnels || []).filter((f: DashboardFunnel) => f.state === "draft");
  const activeSetupSessions = (setupSessions || []).filter((s: DashboardSetupSession) => !s.completed && !s.abandoned);

  // If workspace has a live funnel, show operational dashboard
  if (publishedFunnels.length > 0) {
    return {
      mode: "operational",
      heading: null, // operational dashboard doesn't use the launch guide
      subheading: null,
      nextAction: null,
      progress: { stage: "launched" },
    };
  }

  // Launch guide mode — determine the next action
  let heading = "Let's build your first funnel.";
  let subheading = "Start with who you want to reach and what you're offering. Roo will help you prepare the content and turn it into a funnel.";
  let nextAction: DashboardNextAction | null = null;
  let stage = "prepare";

  // Priority: explicitly resumed setup > preparation steps > continue drafts > build new
  if (activeSetupSessions.length > 0) {
    const session = activeSetupSessions[0];
    nextAction = {
      label: `Continue setting up ${session.funnel_name || "your funnel"}`,
      destination: `/guided-setup?session=${session.id}`,
    };
    stage = session.step?.startsWith("build") || session.step === "launch" ? "build" : "prepare";
  } else if (!hasBusinessBasics) {
    nextAction = {
      label: "Add my business basics",
      destination: "/marketing-kit",
    };
    stage = "prepare";
  } else if (readyAudiences.length === 0) {
    // Resume an existing audience draft if one exists
    if (draftAudiences.length > 0) {
      nextAction = {
        label: "Finish my audience",
        destination: "/marketing-kit?area=audiences",
      };
    } else {
      nextAction = {
        label: "Define my audience",
        destination: "/marketing-kit?area=audiences",
      };
    }
    stage = "prepare";
  } else if (readyOffers.length === 0) {
    if (draftOffers.length > 0) {
      nextAction = {
        label: "Finish my offer",
        destination: "/marketing-kit?area=offers",
      };
    } else {
      nextAction = {
        label: "Create my offer",
        destination: "/marketing-kit?area=offers",
      };
    }
    stage = "prepare";
  } else if (draftFunnels.length > 0) {
    // Preparation done — resume an existing draft
    const draft = draftFunnels[0];
    nextAction = {
      label: `Continue setting up ${draft.name}`,
      destination: `/funnels/${draft.id}`,
    };
    stage = "build";
  } else {
    nextAction = {
      label: "Build my first funnel",
      destination: "/guided-setup",
    };
    stage = "build";
  }

  return {
    mode: "launch_guide",
    heading,
    subheading,
    nextAction,
    progress: { stage },
  };
}
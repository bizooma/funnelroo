import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { requireMembership, firstRecord, asArray, ok, err, HttpError } from "../../shared/auth.ts";

// Roo: the contextual assistant. Drafts content from the approved brief only.
// Never invents testimonials, results, qualifications, deadlines or scarcity.
// All output is labeled as a suggestion for an authorized user to approve.

const SYSTEM_RULES = `You are Roo, the friendly assistant inside FunnelRoo, a sales-funnel builder.
You help a business turn its offer into working funnel pages, resources, emails and campaign copy.

Strict rules:
- Use ONLY the approved business brief, audience and offer provided. Mark anything you infer as "AI suggestion".
- NEVER invent testimonials, customer names, statistics, results, qualifications, deadlines or scarcity. If proof is missing, say so and suggest the user add approved proof.
- Keep copy professional, clear and benefit-focused. Avoid hype and jargon.
- Return valid JSON matching the requested schema only. No markdown fences.`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // Roo always operates within an authorized workspace.
    await requireMembership(base44, body.workspace_id);

    // Load the shared brief for context.
    const profile = firstRecord(
      await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id })
    );
    const audiences = asArray(
      await sr.entities.Audience.filter({ workspace_id: body.workspace_id })
    );
    const offers = asArray(
      await sr.entities.Offer.filter({ workspace_id: body.workspace_id })
    );

    // Only approved/ready audiences and offers are used as Roo context. When a
    // specific audience_id or offer_id is provided (e.g. from a funnel's
    // selected context), use ONLY that reviewed revision — not every approved
    // asset in the workspace.
    let contextAudiences = audiences.filter((a) => a.approved || a.status === "ready");
    let contextOffers = offers.filter((o) => o.approved || o.status === "ready");
    if (body.audience_id) {
      contextAudiences = audiences.filter((a) => a.id === body.audience_id);
    }
    if (body.offer_id) {
      contextOffers = offers.filter((o) => o.id === body.offer_id);
    }
    const approvedAudiences = contextAudiences;
    const approvedOffers = contextOffers;
    const unapprovedCount = (audiences.length - audiences.filter((a) => a.approved || a.status === "ready").length) + (offers.length - offers.filter((o) => o.approved || o.status === "ready").length);

    const briefText = `BUSINESS BRIEF:
- Business name: ${profile?.business_name || "(not set)"}
- Website: ${profile?.website || "(not set)"}
- Primary service: ${profile?.primary_service || "(not set)"}
- Brand voice: ${profile?.brand_voice || "(not set)"}
- Audience summary: ${profile?.audience_summary || "(not set)"}
- Offer summary: ${profile?.offer_summary || "(not set)"}
- Approved facts: ${JSON.stringify(profile?.approved_facts || [])}
- Language to use: ${JSON.stringify(profile?.language_to_use || [])}
- Language to avoid: ${JSON.stringify(profile?.language_to_avoid || [])}
APPROVED AUDIENCES: ${JSON.stringify(approvedAudiences.map((a) => ({ name: a.name, problems: a.problems, objections: a.objections, desired_outcomes: a.desired_outcomes })))}
APPROVED OFFERS: ${JSON.stringify(approvedOffers.map((o) => ({ name: o.name, offer: o.offer, goal: o.goal, cta: o.cta })))}
${unapprovedCount > 0 ? `NOTE: ${unapprovedCount} unapproved audience/offer item(s) exist but are excluded from this context. Do not reference them; suggest the user review and approve them in Settings if relevant.` : ""}`;

    // ---- draftPageCopy: draft hero + benefits for a funnel type ----
    if (action === "draftPageCopy") {
      const funnelType = body.funnel_type || "lead_magnet";
      const schema = {
        type: "object",
        properties: {
          hero: {
            type: "object",
            properties: { headline: { type: "string" }, subheadline: { type: "string" }, cta_label: { type: "string" } },
          },
          benefits: {
            type: "object",
            properties: { heading: { type: "string" }, items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } } } } },
          },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Funnel type: ${funnelType}
Draft the hero section and a benefits section for this funnel's landing page.
The benefits should reflect the audience's desired outcomes and the offer's value.
Do not invent proof. If the brief lacks specifics, keep copy general and note it.
Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ draft: result, ai_suggested: true });
    }

    // ---- draftAudience: suggest an audience from the brief ----
    if (action === "draftAudience") {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          roles_industries: { type: "string" },
          problems: { type: "array", items: { type: "string" } },
          desired_outcomes: { type: "array", items: { type: "string" } },
          objections: { type: "array", items: { type: "string" } },
          alternatives: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Propose ONE target audience for this business based on the brief. Mark inferred assumptions as AI suggestions in the notes. Do not invent statistics.
Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ draft: result, ai_suggested: true });
    }

    // ---- draftOffer: suggest an offer for a goal ----
    if (action === "draftOffer") {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          offer: { type: "string" },
          goal: { type: "string" },
          cta: { type: "string" },
          supporting_proof: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Propose an offer for the goal "${body.goal || "lead_magnet"}". The CTA should match the goal. Do not invent results or testimonials; if proof is missing, suggest the user add it.
Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ draft: result, ai_suggested: true });
    }

    // ---- draftSequence: propose a complete 4-email nurture sequence ----
    if (action === "draftSequence") {
      const funnelType = body.funnel_type || "lead_magnet";
      const schema = {
        type: "object",
        properties: {
          steps: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                delay_hours: { type: "number" },
                subject: { type: "string" },
                preview: { type: "string" },
                body: { type: "string" },
                cta_label: { type: "string" },
                cta_url: { type: "string" },
              },
            },
          },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Funnel type: ${funnelType}
Draft a 4-email nurture sequence for this business. Use these defaults:
- Step 1 (delay 0): A useful first step related to the requested resource or inquiry.
- Step 2 (delay 48): An educational tip or common mistake.
- Step 3 (delay 48): Address an objection; include proof only if approved evidence exists.
- Step 4 (delay 72): A clear invitation to book or take the next action.

Rules:
- Use only merge fields {{first_name}}, {{business_name}}, {{offer_name}}, {{booking_url}}, {{resource_title}}.
- For step 4 CTA URL, use {{booking_url}}.
- Do NOT invent testimonials, statistics, discounts, guarantees, or scarcity.
- If proof is missing, keep the objection response general and note it.
- Body should be simple HTML (paragraphs with <p> tags).
Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ draft: result, ai_suggested: true });
    }

    // ---- rewriteStep: rewrite a single email step ----
    if (action === "rewriteStep") {
      const step = body.step || {};
      const instruction = body.instruction || "improve clarity and tone";
      const schema = {
        type: "object",
        properties: {
          delay_hours: { type: "number" },
          subject: { type: "string" },
          preview: { type: "string" },
          body: { type: "string" },
          cta_label: { type: "string" },
          cta_url: { type: "string" },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Rewrite this nurture email. Instruction: ${instruction}
Current step: ${JSON.stringify(step)}
Keep the same merge fields. Do not invent proof or statistics. Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ draft: result, ai_suggested: true });
    }

    // ---- suggestNextStep: Roo explains the next useful action ----
    if (action === "suggestNextStep") {
      const context = body.context || {};
      const schema = {
        type: "object",
        properties: {
          next_step: { type: "string" },
          why: { type: "string" },
          evidence: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Current funnel state: ${JSON.stringify(context)}
Explain the single most useful next action to get this funnel ready to publish. Keep it concrete and short. Note any missing setup (resource, form, sender, sequence, booking) based on the funnel type.
Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      return ok({ suggestion: result });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}
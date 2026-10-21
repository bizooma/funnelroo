import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { requireMembership, firstRecord, asArray, ok, err, HttpError, audienceContentHash } from "../../shared/auth.ts";
import {
  beginMeteredAction,
  completeMeteredAction,
  abortMeteredAction,
  limitBody,
  httpStatusForLimit,
} from "../../shared/enforce.ts";

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

    // Metered AI text action. Capacity is reserved BEFORE the provider call and
    // consumed on success / released on failure, under one logical operation
    // identity: the caller's operation id when it supplies one, so a retry of the
    // same request resolves to the same reservation instead of spending another
    // unit. Viewing, applying, saving and exporting never reach this path.
    const aiText = async (actionName, prompt, schema) => {
      const decision = await beginMeteredAction(sr, {
        workspaceId: body.workspace_id,
        action: actionName,
        metric: "ai_text",
        operationKey: body.operation_id ? `${actionName}:${body.operation_id}` : undefined,
        payload: {
          action: actionName,
          funnel_type: body.funnel_type || "",
          goal: body.goal || "",
          audience_id: body.audience_id || "",
          offer_id: body.offer_id || "",
          instruction: body.instruction || "",
          step: actionName === "rewriteStep" ? body.step || null : null,
        },
      });
      if (!decision.allowed) return { blocked: decision.report };
      try {
        const result = await sr.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: schema,
        });
        await completeMeteredAction(sr, decision, body.workspace_id);
        return { result };
      } catch (e) {
        await abortMeteredAction(sr, decision, body.workspace_id);
        throw e;
      }
    };
    const limitBlocked = (report) =>
      Response.json(limitBody(report), {
        status: httpStatusForLimit(report),
        headers: { "Content-Type": "application/json" },
      });

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
APPROVED AUDIENCES: ${JSON.stringify(approvedAudiences.map((a) => ({ name: a.name, problems: a.problems, objections: a.objections, desired_outcomes: a.desired_outcomes, messaging_guidance: (a.persona && !a.persona.stale && a.persona.reviewed_revision) ? (a.persona.messaging_guidance || []) : [] })))}
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
      const ai = await aiText("draftPageCopy", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({ draft: ai.result, ai_suggested: true });
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
      const ai = await aiText("draftAudience", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({ draft: ai.result, ai_suggested: true });
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
      const ai = await aiText("draftOffer", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({ draft: ai.result, ai_suggested: true });
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
      const ai = await aiText("draftSequence", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({ draft: ai.result, ai_suggested: true });
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
      const ai = await aiText("rewriteStep", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({ draft: ai.result, ai_suggested: true });
    }

    // ---- suggestNextStep: Roo explains the next useful action ----
    // Not metered: this is a navigation hint, not a requested draft result.
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

    // ---- refinePersona: structured suggestions for a persona card ----
    // Returns editable suggestions with provenance, based ONLY on the selected
    // audience revision. Never invents demographics, quotes, budgets or traits.
    if (action === "refinePersona") {
      const audience = contextAudiences[0];
      if (!audience) return err(404, "Audience not found or not approved for tailored content");
      const schema = {
        type: "object",
        properties: {
          archetype_title: { type: "string" },
          bio_summary: { type: "string" },
          representative_statement: { type: "string" },
          motivation_labels: { type: "array", items: { type: "string" } },
          messaging_guidance: {
            type: "array",
            items: {
              type: "object",
              properties: { heading: { type: "string" }, text: { type: "string" } },
            },
          },
          notes: { type: "string" },
        },
      };
      const prompt = `${SYSTEM_RULES}

${briefText}

Selected audience (the ONLY audience to use):
- Name: ${audience.name}
- Who they are: ${audience.roles_industries || "(not specified)"}
- Problems: ${JSON.stringify(audience.problems || [])}
- Desired outcomes: ${JSON.stringify(audience.desired_outcomes || [])}
- Objections: ${JSON.stringify(audience.objections || [])}
- Existing solutions: ${JSON.stringify(audience.alternatives || [])}

Help present this audience as a one-page persona card for internal marketing reference.
1. Suggest a short archetype title (e.g. "The Hands-On Agency Owner"). Do NOT invent a personal name.
2. Draft a 2-3 sentence factual bio summary from the audience profile above. Do not invent demographics, age, family, income or budget.
3. Draft ONE representative statement in the audience's voice that reflects their stated problem or goal. This is an illustrative statement, NOT a customer quote.
4. Suggest up to 6 purchasing-relevant motivation labels for this audience (labels only, no ratings).
5. Offer 2-3 short messaging guidance notes for speaking to this audience. For each, optionally label it with a concise heading such as "Lead with", "Address", or "Avoid" where it fits the content; leave heading empty otherwise. Return each as { heading, text }.
Mark anything inferred as an AI suggestion in the notes. Return JSON matching this schema: ${JSON.stringify(schema)}`;
      const ai = await aiText("refinePersona", prompt, schema);
      if (ai.blocked) return limitBlocked(ai.blocked);
      return ok({
        draft: { ...ai.result, provenance: "Suggested by Roo — review needed" },
        source_revision: audienceContentHash(audience),
        ai_suggested: true,
      });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}
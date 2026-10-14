import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";
import { buildBookingLink } from "../../shared/booking.ts";

// Public, anonymous read of a published funnel by its immutable public_id.
// Returns only approved published content — no drafts, contacts, or secrets.
// The public_id is a globally-unique immutable discriminator so two workspaces
// can never collide on the same public URL.
//
// Also handles createBookingLink: creates a server-issued BookingContext for
// the published funnel/version and returns a tracked scheduling URL with an
// opaque token round-tripped via utm_content.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "get";
    const sr = base44.asServiceRole;

    // ---- createBookingLink: create a BookingContext and return a tracked URL ----
    if (action === "createBookingLink") {
      const publicId = String(body.public_id || "").trim();
      if (!publicId) return err(400, "Missing funnel identifier");

      const funnel = firstRecord(
        await sr.entities.Funnel.filter({ public_id: publicId, state: "published" })
      );
      if (!funnel) return err(404, "Funnel not found or not published");

      const version = firstRecord(
        await sr.entities.PublishedFunnelVersion.filter({ id: funnel.active_version_id, active: true })
      );
      if (!version) return err(404, "No active published version");

      const snapshot = version.snapshot || {};
      const bookingEventType = snapshot.booking_event_type || null;
      const bookingUrl = snapshot.booking_config?.calendly_url || bookingEventType?.scheduling_url || "";
      if (!bookingUrl) return err(400, "This funnel has no booking URL configured");

      // Resolve connection and event type for context validation
      let connectionId = "";
      let eventTypeId = "";
      if (snapshot.booking_event_type_id) {
        const et = firstRecord(
          await sr.entities.BookingEventType.filter({ id: snapshot.booking_event_type_id, workspace_id: funnel.workspace_id })
        );
        if (et) {
          eventTypeId = et.id;
          connectionId = et.connection_id || "";
        }
      }

      const { url, token } = await buildBookingLink(sr, {
        workspaceId: funnel.workspace_id,
        connectionId,
        eventTypeId,
        schedulingUrl: bookingUrl,
        funnelId: funnel.id,
        publishedVersionId: version.id,
        sourceChannel: "public_page",
      });

      return ok({ booking_url: url, token });
    }

    // ---- default: get published funnel by public_id ----
    const publicId = String(body.public_id || "").trim();
    if (!publicId) return err(400, "Missing funnel identifier");

    const funnel = firstRecord(
      await sr.entities.Funnel.filter({ public_id: publicId, state: "published" })
    );
    if (!funnel) return err(404, "Funnel not found or not published");

    const version = firstRecord(
      await sr.entities.PublishedFunnelVersion.filter({
        id: funnel.active_version_id,
        active: true,
      })
    );
    if (!version) return err(404, "No active published version");

    const snapshot = version.snapshot || {};
    const blocks = snapshot.page_blocks || [];
    const formBlock = blocks.find((b) => b.type === "form");
    const formFields = formBlock?.props?.fields || [];
    const formVersion = JSON.stringify(formFields.map((f) => ({ n: f.name, l: f.label, t: f.type, r: !!f.required })));
    // Booking event type info (safe presentation fields only — no provider identifiers)
    const bookingEventType = snapshot.booking_event_type || null;
    const bookingUrl = snapshot.booking_config?.calendly_url || bookingEventType?.scheduling_url || "";
    const bookingCtaLabel = snapshot.booking_cta_label || "Book a time";
    const bookingCtaCopy = snapshot.booking_cta_copy || "";

    // SEO data: prefer funnel-level overrides, fall back to hero block content.
    const heroBlock = blocks.find((b) => b.type === "hero");
    const heroHeadline = heroBlock?.props?.headline || "";
    const heroSubheadline = heroBlock?.props?.subheadline || "";
    // Workspace logo for og:image fallback chain
    const businessProfile = firstRecord(
      await sr.entities.BusinessProfile.filter({ workspace_id: funnel.workspace_id })
    );
    const workspaceLogo = businessProfile?.logo_url || "";

    return ok({
      funnel: {
        name: funnel.name,
        type: funnel.type,
        slug: funnel.slug,
        public_id: funnel.public_id,
        goal: funnel.goal,
        seo_title: funnel.seo_title || "",
        seo_description: funnel.seo_description || "",
        social_image_url: funnel.social_image_url || "",
      },
      seo: {
        title: funnel.seo_title || `${funnel.name} — ${heroHeadline || "Book a time"}`,
        description: (funnel.seo_description || heroSubheadline || "").slice(0, 155),
        canonical_url: `https://funnelroo.com/f/${funnel.public_id}`,
        social_image_url: funnel.social_image_url || workspaceLogo || "",
      },
      hero_headline: heroHeadline,
      hero_subheadline: heroSubheadline,
      version: {
        version_number: version.version_number,
        published_at: version.published_at,
        snapshot,
        version_id: version.id,
      },
      form_version: formVersion,
      delivery_mode: snapshot.delivery_mode || "immediate_only",
      consent_text: snapshot.consent_text || "",
      resource: snapshot.resource_version_id
        ? { title: snapshot.resource_title || "", delivery_mode: snapshot.delivery_mode || "immediate_only" }
        : null,
      booking: bookingUrl ? {
        url: bookingUrl,
        cta_label: bookingCtaLabel,
        cta_copy: bookingCtaCopy,
        event_type_name: bookingEventType?.display_name || "",
        duration_minutes: bookingEventType?.duration_minutes || null,
      } : null,
    });
  } catch (e) {
    return err(500, e.message);
  }
}
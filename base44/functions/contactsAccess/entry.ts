import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import { processDeliveryJob } from "../../shared/delivery.ts";

// Workspace-authorized contact management: list, detail, notes, retry.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- list ----
    if (action === "list") {
      await requireMembership(base44, body.workspace_id);
      const query = { workspace_id: body.workspace_id };
      if (body.search) {
        query.$or = [
          { email_normalized: { $regex: String(body.search).toLowerCase(), $options: "i" } },
          { display_name: { $regex: String(body.search), $options: "i" } },
          { company: { $regex: String(body.search), $options: "i" } },
        ];
      }
      const contacts = asArray(
        await sr.entities.Contact.filter(query, { sort: "-created_date", limit: 50 })
      );
      // attach funnel participations + latest activity
      const contactIds = contacts.map((c) => c.id);
      let leadsByContact = {};
      let lastByContact = {};
      if (contactIds.length) {
        const leads = asArray(await sr.entities.FunnelLead.filter({ contact_id: { $in: contactIds } }));
        const funnelIds = [...new Set(leads.map((l) => l.funnel_id))];
        const funnels = funnelIds.length ? asArray(await sr.entities.Funnel.filter({ id: { $in: funnelIds } })) : [];
        const funnelsById = {};
        funnels.forEach((f) => (funnelsById[f.id] = f));
        leads.forEach((l) => {
          if (!leadsByContact[l.contact_id]) leadsByContact[l.contact_id] = [];
          leadsByContact[l.contact_id].push({ funnel_name: funnelsById[l.funnel_id]?.name || "—", last_seen_at: l.last_seen_at });
          const t = l.last_seen_at || l.first_seen_at;
          if (t && (!lastByContact[l.contact_id] || t > lastByContact[l.contact_id])) lastByContact[l.contact_id] = t;
        });
      }
      return ok({
        contacts: contacts.map((c) => ({
          ...c,
          funnels: leadsByContact[c.id] || [],
          latest_activity: lastByContact[c.id] || c.created_date,
        })),
      });
    }

    // ---- get (full detail) ----
    if (action === "get") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      await requireMembership(base44, contact.workspace_id);
      const [leads, submissions, consents] = await Promise.all([
        sr.entities.FunnelLead.filter({ contact_id: contact.id }),
        sr.entities.Submission.filter({ contact_id: contact.id }, { sort: "-accepted_at" }),
        sr.entities.ConsentRecord.filter({ contact_id: contact.id }, { sort: "-created_date" }),
      ]);
      const subArr = asArray(submissions);
      const subIds = subArr.map((s) => s.id);
      let grants = [];
      let jobs = [];
      if (subIds.length) {
        grants = asArray(await sr.entities.ResourceGrant.filter({ submission_id: { $in: subIds } }));
        jobs = asArray(await sr.entities.DeliveryJob.filter({ submission_id: { $in: subIds } }, { sort: "-created_date" }));
      }
      const funnelIds = [...new Set(asArray(leads).map((l) => l.funnel_id))];
      const funnels = funnelIds.length ? asArray(await sr.entities.Funnel.filter({ id: { $in: funnelIds } })) : [];
      const funnelsById = {};
      funnels.forEach((f) => (funnelsById[f.id] = f));
      return ok({
        contact,
        leads: asArray(leads).map((l) => ({ ...l, funnel_name: funnelsById[l.funnel_id]?.name || "—" })),
        submissions: subArr,
        grants,
        delivery_jobs: jobs,
        consents: asArray(consents),
      });
    }

    // ---- updateNotes ----
    if (action === "updateNotes") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      await requireMembership(base44, contact.workspace_id, ["owner", "admin", "member"]);
      const updated = await sr.entities.Contact.update(contact.id, { notes: String(body.notes || "") });
      return ok({ contact: updated });
    }

    // ---- retryDelivery (owner/admin) ----
    if (action === "retryDelivery") {
      const job = firstRecord(await sr.entities.DeliveryJob.filter({ id: body.job_id }));
      if (!job) return err(404, "Delivery job not found");
      await requireMembership(base44, job.workspace_id, ["owner", "admin"]);
      if (job.state === "delivered" || job.state === "provider_accepted") {
        return ok({ job, skipped: "already accepted" });
      }
      const origin = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
      const updated = await sr.entities.DeliveryJob.update(job.id, { state: "pending", last_error: "" });
      const result = await processDeliveryJob(base44, updated, origin);
      return ok({ job: result });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}
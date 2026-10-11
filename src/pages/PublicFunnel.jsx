import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { PageRenderer } from "@/components/funnel/PageRenderer";
import { MascotBadge } from "@/components/MascotBadge";
import { Loader2, FileQuestion } from "lucide-react";

// Anonymous public funnel page. No auth required. Reads only the approved
// published snapshot (resolved by immutable public_id), submits the form with
// a published-version binding to the capture backend, and shows a branded
// confirmation with immediate resource access.
export default function PublicFunnel() {
  const { publicId } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formState, setFormState] = useState({ submitting: false, error: "", confirmation: null, consentText: "" });
  const requestIdRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await base44.functions.invoke("getPublishedFunnel", { public_id: publicId });
        if (res.status === 200) {
          setData(res.data);
          setFormState((s) => ({ ...s, consentText: res.data?.consent_text || "" }));
        } else {
          setError(res.data?.error || "Funnel not available");
        }
      } catch (e) {
        setError(e.response?.data?.error || "Funnel not found or not published");
      } finally {
        setLoading(false);
      }
    })();
  }, [publicId]);

  async function handleSubmit(answers, consentChoice, honeypot) {
    // generate (or reuse) a request id for this attempt cycle — retries reuse it
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    const request_id = requestIdRef.current;
    setFormState((s) => ({ ...s, submitting: true, error: "" }));
    try {
      const res = await base44.functions.invoke("captureSubmission", {
        public_id: publicId,
        published_version_id: data?.version?.version_id,
        request_id,
        form_version: data?.form_version,
        answers,
        consent_choice: consentChoice,
        source: searchParams.get("utm_source") || "",
        campaign: searchParams.get("utm_campaign") || "",
        website: honeypot,
      });
      if (res.status === 200) {
        setFormState({ submitting: false, error: "", confirmation: res.data?.confirmation, consentText: data?.consent_text || "" });
        requestIdRef.current = null; // a later intentional resubmit gets a fresh id
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (res.status === 409) {
        if (res.data?.conflict) {
          setFormState((s) => ({ ...s, submitting: false, error: "This form was already submitted with different data. Please reload the page." }));
        } else {
          // stale form version — ask the visitor to reload
          setFormState((s) => ({ ...s, submitting: false, error: "This page has been updated. Please reload and resubmit the current form." }));
        }
        requestIdRef.current = null;
      } else if (res.status === 429) {
        setFormState((s) => ({ ...s, submitting: false, error: res.data?.error || "Too many submissions. Please wait a moment." }));
        requestIdRef.current = null;
      } else {
        setFormState((s) => ({ ...s, submitting: false, error: res.data?.error || "Submission failed. Please try again." }));
        // keep request_id for retry on recoverable failure
      }
    } catch (e) {
      setFormState((s) => ({ ...s, submitting: false, error: e.response?.data?.error || "Network error. Please try again." }));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <FileQuestion className="w-7 h-7 text-slate-400" />
        </div>
        <h1 className="text-lg font-semibold text-slate-700">This funnel isn't available</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">{error}. It may be unpublished, paused, or the link may be incorrect.</p>
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <MascotBadge size={24} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    );
  }

  const snapshot = data?.version?.snapshot || {};
  const blocks = snapshot.page_blocks || [];
  const theme = snapshot.theme || {};

  return (
    <div className="min-h-screen bg-white">
      <PageRenderer blocks={blocks} theme={theme} mode="public" onSubmit={handleSubmit} formState={formState} />
      <div className="py-6 text-center">
        <div className="inline-flex items-center gap-2 text-xs text-slate-300">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    </div>
  );
}
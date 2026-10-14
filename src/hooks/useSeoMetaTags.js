import { useEffect, useRef } from "react";

const DEFAULT_OG_IMAGE = "https://media.base44.com/images/public/6acba9de240facdd95f5665d/59cc7ba1c_logo.png";
const SITE_ORIGIN = "https://funnelroo.com";

// Tags managed by this hook. Each entry is [selector, attribute] so we can
// find-or-create the element and clean up only what we own on unmount.
const MANAGED_TAGS = [
  ["title", null],
  ['meta[name="description"]', "name"],
  ['link[rel="canonical"]', "rel"],
  ['meta[property="og:title"]', "property"],
  ['meta[property="og:description"]', "property"],
  ['meta[property="og:type"]', "property"],
  ['meta[property="og:url"]', "property"],
  ['meta[property="og:image"]', "property"],
  ['meta[name="twitter:card"]', "name"],
  ['meta[name="twitter:title"]', "name"],
  ['meta[name="twitter:description"]', "name"],
  ['meta[name="twitter:image"]', "name"],
  ['meta[name="robots"]', "name"],
];

function upsertMeta(selector, attr, content) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr.split("=")[0], attr.split("=")[1].replace(/"/g, ""));
    document.head.appendChild(el);
  }
  if (content === null || content === undefined) {
    el.setAttribute("content", "");
  } else {
    el.setAttribute("content", String(content));
  }
  el.dataset.funnelSeo = "true";
  return el;
}

function upsertLink(selector, href) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
  el.dataset.funnelSeo = "true";
  return el;
}

function upsertTitle(text) {
  let el = document.head.querySelector("title");
  if (!el) {
    el = document.createElement("title");
    document.head.appendChild(el);
  }
  el.textContent = text;
  el.dataset.funnelSeo = "true";
}

function removeManagedTags() {
  document.head.querySelectorAll("[data-funnel-seo]").forEach((el) => el.remove());
}

/**
 * Manages SEO + social meta tags in document <head> for public funnel pages.
 * Sets tags as soon as `seo` data resolves; cleans up all managed tags on
 * unmount so client-side navigation between funnels doesn't leak stale tags.
 *
 * @param {object|null} seo - SEO data, or null while loading / on error.
 * @param {boolean} seo.indexable - Whether the page should be indexed.
 * @param {string} seo.title - The <title> and og:title / twitter:title.
 * @param {string} seo.description - The meta description and og:description.
 * @param {string} seo.canonicalUrl - The canonical URL.
 * @param {string} seo.ogImage - The og:image / twitter:image URL.
 */
export function useSeoMetaTags(seo) {
  const seoRef = useRef(seo);
  seoRef.current = seo;

  useEffect(() => {
    const s = seoRef.current;
    if (!s) return;

    if (!s.indexable) {
      upsertMeta('meta[name="robots"]', 'name="robots"', "noindex");
      upsertTitle(s.title || "FunnelRoo");
      return;
    }

    upsertTitle(s.title || "FunnelRoo");
    upsertMeta('meta[name="description"]', 'name="description"', (s.description || "").slice(0, 155));
    upsertLink('link[rel="canonical"]', s.canonicalUrl);
    upsertMeta('meta[property="og:title"]', 'property="og:title"', s.title);
    upsertMeta('meta[property="og:description"]', 'property="og:description"', (s.description || "").slice(0, 300));
    upsertMeta('meta[property="og:type"]', 'property="og:type"', "website");
    upsertMeta('meta[property="og:url"]', 'property="og:url"', s.canonicalUrl);
    upsertMeta('meta[property="og:image"]', 'property="og:image"', s.ogImage || DEFAULT_OG_IMAGE);
    upsertMeta('meta[name="twitter:card"]', 'name="twitter:card"', "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', 'name="twitter:title"', s.title);
    upsertMeta('meta[name="twitter:description"]', 'name="twitter:description"', (s.description || "").slice(0, 200));
    upsertMeta('meta[name="twitter:image"]', 'name="twitter:image"', s.ogImage || DEFAULT_OG_IMAGE);

    return () => {
      removeManagedTags();
    };
  }, [seo]);
}
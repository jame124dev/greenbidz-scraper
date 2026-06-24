import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link as LinkIcon,
  AlertTriangle,
  Play,
  Loader2,
  Globe,
  List,
  MousePointerClick,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';
import { useLayout } from '@/components/layout/layout-context';
import { useProfiles, useRunProfile } from '@/hooks/useApi';
import { useScrapeLock } from '@/hooks/useScrapeLock';
import type { ProfileListItem } from '@/types/api';
import { useSelectorBridge } from './useSelectorBridge';
import { PagePreview } from './PagePreview';
import { FieldPanel } from './FieldPanel';
import { ReviewStep } from './ReviewStep';
import { SitemapStep } from './SitemapStep';
import {
  emptyDraft,
  profileToDraft,
  generalizeNextSelector,
  generalizeProductLink,
  IMAGES_KEY,
  NEXT_KEY,
  PRODUCT_LINK_KEY,
  type FieldType,
  type MappingDraft,
  type PickedMessage,
} from './types';

const STEPS = ['URLs', 'Listing', 'Fields', 'Review'] as const;

// Display-only metadata for the stepper (icons + one-line descriptions). Kept
// separate from STEPS so none of the step logic changes.
const STEP_META: { label: string; desc: string; icon: LucideIcon }[] = [
  { label: 'URLs', desc: 'Enter the listing page', icon: LinkIcon },
  { label: 'Listing', desc: 'Pick product link & next', icon: List },
  { label: 'Fields', desc: 'Map detail fields', icon: MousePointerClick },
  { label: 'Review', desc: 'Confirm & save profile', icon: ClipboardCheck },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normHost(url: string): string {
  return hostOf(url).replace(/^www\./, '').toLowerCase();
}

export function MappingStudioPage() {
  const [searchParams] = useSearchParams();
  const editFileName = searchParams.get('edit'); // present → editing an existing profile
  const [draft, setDraft] = useState<MappingDraft>(emptyDraft);
  const [step, setStep] = useState(0);
  const hydratedRef = useRef(false); // edit-mode prefill happens once
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [hoverText, setHoverText] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [forceReload, setForceReload] = useState(false); // true → bypass backend cache
  const [nav, setNav] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  // null = undecided; 'override' = overwrite the matched profile; 'new' = build
  // a separate new profile for the same domain.
  const [profileMode, setProfileMode] = useState<'override' | 'new' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect an existing profile for the entered listing URL's domain.
  const profiles = useProfiles().data?.profiles ?? [];
  const matchedProfile = useMemo(() => {
    const host = normHost(draft.listingUrl);
    if (!host) return null;
    return profiles.find((p) => p.domain && normHost(`http://${p.domain}`) === host) ?? null;
  }, [profiles, draft.listingUrl]);

  // Re-require the choice if the URL changes.
  useEffect(() => setProfileMode(null), [draft.listingUrl]);

  const update = useCallback((patch: Partial<MappingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  // In sitemap/auto discovery, step 1 ("Listing") is replaced by the Sitemap
  // explorer — there's no listing page to map a Next button on.
  const sitemapMode = draft.discoveryMode === 'sitemap' || draft.discoveryMode === 'auto';

  // Edit mode: load the saved profile once and hydrate the draft, then jump to
  // the Fields step (or Listing if no sample product URL is stored).
  useEffect(() => {
    if (!editFileName || hydratedRef.current) return;
    hydratedRef.current = true;
    api
      .getProfileConfig(editFileName)
      .then(({ config }) => {
        setDraft(profileToDraft(config));
        setStep(config.sampleProductUrl ? 2 : 1);
      })
      .catch(() => {
        /* fall back to a blank draft */
      });
  }, [editFileName]);

  // ── picking ──────────────────────────────────────────────────────────────────
  const onPicked = useCallback(
    (m: PickedMessage) => {
      const { field, payload, items } = m;
      if (field === PRODUCT_LINK_KEY) {
        // Generalize: a single clicked card → a selector + pattern matching ALL cards.
        const gen = payload.href ? generalizeProductLink(payload.href) : null;
        setDraft((d) => ({
          ...d,
          productLinkSelector: gen?.linkSelector || payload.selector,
          productUrlPattern: gen?.productUrlPattern || d.productUrlPattern,
          urlPattern: gen?.urlPattern || d.urlPattern,
          sampleProductUrl: d.sampleProductUrl || payload.href || '',
          domain: d.domain || hostOf(payload.href || ''),
        }));
        setArmedKey(null);
      } else if (field === NEXT_KEY) {
        update({ nextSelector: generalizeNextSelector(payload) });
        setArmedKey(null);
      } else if (field === IMAGES_KEY) {
        update({
          images: items.map((it) => ({
            selector: it.selector,
            src: it.imgSrc,
            classes: it.classes,
          })),
        });
        // stay armed for further multi-picks
      } else {
        setDraft((d) => ({
          ...d,
          fields: d.fields.map((f) =>
            f.key === field
              ? { ...f, selector: payload.selector, xpath: payload.xpath ?? undefined, sampleValue: payload.text }
              : f,
          ),
        }));
        setArmedKey(null);
      }
    },
    [update],
  );

  // Point the preview at a URL (updates the current step's target). Not a
  // history push — used by both push-navigation and back/forward.
  const applyTarget = useCallback(
    (u: string) => {
      setForceReload(false); // navigating/back-forward may use the cache
      if (step === 1) update({ listingUrl: u });
      else if (step === 2) update({ sampleProductUrl: u });
    },
    [step, update],
  );

  // Navigate the preview to a new URL + push onto history (address bar + link
  // clicks). Truncates any forward entries, browser-style.
  const onNavigate = useCallback(
    (u: string) => {
      applyTarget(u);
      setNav((prev) => {
        const base = prev.stack.slice(0, prev.index + 1);
        if (base[base.length - 1] === u) return { stack: base, index: base.length - 1 };
        const stack = [...base, u];
        return { stack, index: stack.length - 1 };
      });
    },
    [applyTarget],
  );

  const goPreviewBack = useCallback(() => {
    setNav((prev) => {
      if (prev.index <= 0) return prev;
      const i = prev.index - 1;
      applyTarget(prev.stack[i]);
      return { ...prev, index: i };
    });
  }, [applyTarget]);

  const goPreviewForward = useCallback(() => {
    setNav((prev) => {
      if (prev.index >= prev.stack.length - 1) return prev;
      const i = prev.index + 1;
      applyTarget(prev.stack[i]);
      return { ...prev, index: i };
    });
  }, [applyTarget]);

  const bridge = useSelectorBridge({
    onPicked,
    onReady: () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
      setLoadingPage(false);
      setLoadError(null);
    },
    onHover: (m) => setHoverText(m.text),
    // Browser-like: clicking a link in the preview (when not mapping) follows it.
    onNavigate: (m) => onNavigate(m.url),
  });

  const { arm: armBridge, disarm, clear: clearBridge, countMatches } = bridge;

  const arm = useCallback(
    (key: string) => {
      setArmedKey(key);
      armBridge(key, { multi: key === IMAGES_KEY });
    },
    [armBridge],
  );

  const clear = useCallback(
    (key: string) => {
      if (key === PRODUCT_LINK_KEY) update({ productLinkSelector: undefined });
      else if (key === NEXT_KEY) update({ nextSelector: undefined });
      else if (key === IMAGES_KEY) update({ images: [] });
      else
        setDraft((d) => ({
          ...d,
          fields: d.fields.map((f) =>
            f.key === key ? { ...f, selector: undefined, xpath: undefined, sampleValue: undefined } : f,
          ),
        }));
      clearBridge(key);
      if (armedKey === key) {
        setArmedKey(null);
        disarm();
      }
    },
    [armedKey, clearBridge, disarm, update],
  );

  // ── field editing ─────────────────────────────────────────────────────────────
  const addCustom = useCallback((label: string) => {
    const key = label.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'field';
    setDraft((d) =>
      d.fields.some((f) => f.key === key)
        ? d
        : { ...d, fields: [...d.fields, { key, label, type: 'text', required: false, builtin: false }] },
    );
  }, []);
  const removeField = useCallback((key: string) => {
    setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.key !== key) }));
  }, []);
  const toggleRequired = useCallback((key: string) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.key === key ? { ...f, required: !f.required } : f)),
    }));
  }, []);
  const setType = useCallback((key: string, type: FieldType) => {
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, type } : f)) }));
  }, []);
  // Manually edit a field's selector (override the picked one). Clearing the
  // text unsets the mapping (so the field reverts to its unmapped state).
  const setSelector = useCallback((key: string, selector: string) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) =>
        f.key === key ? { ...f, selector: selector.trim() ? selector : undefined } : f,
      ),
    }));
  }, []);
  const removeImage = useCallback((index: number) => {
    setDraft((d) => ({ ...d, images: d.images.filter((_, i) => i !== index) }));
  }, []);

  // ── current page src ───────────────────────────────────────────────────────────
  const targetUrl =
    step === 1 && !sitemapMode ? draft.listingUrl : step === 2 ? draft.sampleProductUrl : '';
  const src = useMemo(
    () =>
      targetUrl
        ? `${api.proxyPageSrc(targetUrl)}&_n=${reloadNonce}${forceReload ? `&fresh=${reloadNonce}` : ''}`
        : null,
    [targetUrl, reloadNonce, forceReload],
  );

  // Seed browsing history when entering a render step (Listing / Fields).
  useEffect(() => {
    if (step === 1 || step === 2) {
      setNav(targetUrl ? { stack: [targetUrl], index: 0 } : { stack: [], index: -1 });
    }
    // Only on step change — navigation within a step manages history itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Reset interaction state whenever the loaded page changes, and arm a timeout
  // so a page that never finishes rendering surfaces an error (not an endless spinner).
  useEffect(() => {
    if (!src) return undefined;
    setLoadingPage(true);
    setLoadError(null);
    setArmedKey(null);
    setHoverText(null);
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => {
      setLoadingPage(false);
      setLoadError(
        'This page took too long to render. It may be very slow or blocking automated access — try Reload, or check the URL.',
      );
    }, 90000);
    return () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [src]);

  // Fail fast when the backend returns its "could not render" HTML page.
  const onRenderError = useCallback((msg: string) => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoadingPage(false);
    setLoadError(msg);
  }, []);

  // Collapse the sidebar while the render screen is shown (steps 1 & 2) so the
  // external website gets a big canvas; restore it elsewhere and on unmount.
  const { setCollapsed } = useLayout();
  useEffect(() => {
    // Big canvas only when the page-preview is shown (listing/fields steps).
    setCollapsed((step === 1 && !sitemapMode) || step === 2);
  }, [step, sitemapMode, setCollapsed]);
  useEffect(() => () => setCollapsed(false), [setCollapsed]);

  // ── step navigation ──────────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 0) {
      update({ domain: draft.domain || hostOf(draft.listingUrl || draft.sampleProductUrl) });
    }
    setArmedKey(null);
    disarm();
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goBack = () => {
    setArmedKey(null);
    disarm();
    setStep((s) => Math.max(0, s - 1));
  };

  const canNext =
    step === 0
      ? isHttpUrl(draft.listingUrl) && (!matchedProfile || profileMode !== null)
      : step === 1
        ? isHttpUrl(draft.sampleProductUrl)
        : true;

  const armedLabel =
    armedKey === IMAGES_KEY
      ? 'Images'
      : armedKey === PRODUCT_LINK_KEY
        ? 'Product link'
        : armedKey === NEXT_KEY
          ? 'Next page'
          : armedKey
            ? draft.fields.find((f) => f.key === armedKey)?.label
            : null;

  return (
    <>
      <PageHeader
        title={editFileName ? 'Edit Scraper — Field Mapping' : 'New Scraper — Visual Mapping Studio'}
        description={
          editFileName
            ? 'Re-pick or override field selectors for this profile, then save to overwrite it.'
            : 'Load a page, click elements to map them to product fields, then save a scraping profile.'
        }
      />

      <Stepper step={step} sitemapMode={sitemapMode} />

      <div className="mt-5">
        {step === 0 && (
          <UrlStep
            draft={draft}
            update={update}
            matchedProfile={matchedProfile}
            profileMode={profileMode}
            onOverride={() => setProfileMode('override')}
            onCreateNew={() => setProfileMode('new')}
            onSubmit={goNext}
            canSubmit={canNext}
          />
        )}

        {step === 1 && sitemapMode && <SitemapStep draft={draft} onChange={update} />}

        {((step === 1 && !sitemapMode) || step === 2) && (
          <div className="grid h-[calc(100vh-340px)] min-h-[480px] grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
            <div className="card overflow-y-auto p-4">
              <FieldPanel
                mode={step === 1 ? 'listing' : 'fields'}
                draft={draft}
                armedKey={armedKey}
                onArm={arm}
                onClear={clear}
                onAddCustom={addCustom}
                onRemoveField={removeField}
                onToggleRequired={toggleRequired}
                onSetType={setType}
                onSetSelector={setSelector}
                onRemoveImage={removeImage}
                onSetCurrency={(c) => update({ priceCurrency: c })}
                countMatches={countMatches}
              />
            </div>
            <PagePreview
              iframeRef={bridge.iframeRef}
              src={src}
              loading={loadingPage}
              error={loadError}
              armedLabel={armedLabel}
              hoverText={hoverText}
              url={targetUrl}
              onReload={() => {
                setForceReload(true); // Reload bypasses the backend snapshot cache
                setReloadNonce((n) => n + 1);
              }}
              onNavigate={onNavigate}
              onRenderError={onRenderError}
              onBack={goPreviewBack}
              onForward={goPreviewForward}
              canBack={nav.index > 0}
              canForward={nav.index < nav.stack.length - 1}
            />
          </div>
        )}

        {step === 3 && (
          <ReviewStep
            draft={draft}
            onChange={update}
            // Where to save: edit → that file; matched + override → overwrite it;
            // matched + new (or no match) → create a fresh (possibly suffixed) profile.
            saveFileName={editFileName ?? (profileMode === 'override' ? matchedProfile?.fileName ?? null : null)}
            createNew={!editFileName && profileMode === 'new'}
            isEdit={!!editFileName}
          />
        )}
      </div>

      {/* Footer nav */}
      {step < 3 && (
        <div className="mt-5 flex items-center justify-between">
          <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={goBack} disabled={step === 0}>
            Back
          </Button>
          <Button onClick={goNext} disabled={!canNext}>
            {step === 2 ? 'Review & Save' : 'Next'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {step === 3 && (
        <div className="mt-5">
          <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={goBack}>
            Back to fields
          </Button>
        </div>
      )}
    </>
  );
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

function Stepper({ step, sitemapMode }: { step: number; sitemapMode: boolean }) {
  const meta = sitemapMode
    ? STEP_META.map((m, i) =>
        i === 1 ? { ...m, label: 'Sitemap', desc: 'Pick product & category URLs' } : m,
      )
    : STEP_META;
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {meta.map((m, i) => {
        const done = i < step;
        const active = i === step;
        const Icon = m.icon;
        return (
          <div key={m.label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                active
                  ? 'border-accent/60 bg-accent/10 shadow-[0_0_0_1px_rgba(34,197,94,0.25)]'
                  : done
                    ? 'border-line bg-panel2'
                    : 'border-line bg-panel',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  done
                    ? 'bg-accent text-accent-ink'
                    : active
                      ? 'bg-accent/20 text-accent'
                      : 'bg-line/50 text-muted',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-xs font-semibold',
                    active ? 'text-accent' : done ? 'text-ink' : 'text-muted',
                  )}
                >
                  {i + 1}. {m.label}
                </div>
                <div className="hidden truncate text-[10px] text-muted sm:block">{m.desc}</div>
              </div>
            </div>
            {i < STEP_META.length - 1 && (
              <div className={cn('h-0.5 w-4 shrink-0 rounded', done ? 'bg-accent' : 'bg-line')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function UrlStep({
  draft,
  update,
  matchedProfile,
  profileMode,
  onOverride,
  onCreateNew,
  onSubmit,
  canSubmit,
}: {
  draft: MappingDraft;
  update: (p: Partial<MappingDraft>) => void;
  matchedProfile: ProfileListItem | null;
  profileMode: 'override' | 'new' | null;
  onOverride: () => void;
  onCreateNew: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
}) {
  const navigate = useNavigate();
  const run = useRunProfile();
  const lock = useScrapeLock(matchedProfile?.fileName ?? '');

  const onScrapeExisting = () => {
    if (!matchedProfile) return;
    run.mutate(matchedProfile.fileName, {
      onSuccess: () => {
        lock.lock();
        toast.success(`Crawl started for “${matchedProfile.profileName || matchedProfile.fileName}”.`);
        navigate('/products');
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card overflow-hidden">
        {/* Header band */}
        <div className="flex items-center gap-3 border-b border-line bg-panel2/40 px-6 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <LinkIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Start a new scraper</div>
            <div className="text-xs text-muted">
              Paste the page that lists the products you want to scrape.
            </div>
          </div>
        </div>

        <div className="p-6">
          <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted">
            Listing URL (product list) *
          </label>
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="https://101lab.co/buyer-marketplace"
              value={draft.listingUrl}
              onChange={(e) => update({ listingUrl: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {draft.discoveryMode === 'sitemap'
              ? 'Any URL on the site works — products are found from the site’s XML sitemap, not this page.'
              : 'Use the page where products are listed and paginated — not a single product page.'}
          </p>

          {/* How product URLs are discovered — chosen up front so the rest of the
              wizard fits the site. */}
          <div className="mt-5 border-t border-line pt-4">
            <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted">
              Product discovery
            </label>
            <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel2 p-1">
              {([
                { value: 'listing', label: 'Crawl listing' },
                { value: 'sitemap', label: 'Sitemap' },
                { value: 'auto', label: 'Auto' },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => update({ discoveryMode: m.value })}
                  className={
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ' +
                    (draft.discoveryMode === m.value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            {draft.discoveryMode !== 'listing' && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted">
                  Sitemap URL (optional)
                </label>
                <input
                  className="input font-mono text-xs"
                  placeholder="auto-detect via robots.txt"
                  value={draft.sitemapUrl ?? ''}
                  onChange={(e) => update({ sitemapUrl: e.target.value || undefined })}
                />
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">
              <b>Crawl listing</b> = page through listing URLs (default).{' '}
              <b>Sitemap</b> = read the site’s XML sitemap to find every product at once — ignores
              categories/pagination; the next “Listing” step is optional.{' '}
              <b>Auto</b> = try the sitemap, fall back to crawling listing pages.
            </p>
          </div>

        {matchedProfile && !profileMode && (
          <div className="mt-4 rounded-lg border border-warn/40 bg-amber-900/20 p-3">
            <div className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                A profile already matches this domain:{' '}
                <code className="font-mono">{matchedProfile.fileName}</code>
                {matchedProfile.profileName ? ` (${matchedProfile.profileName})` : ''}. Choose what
                to do — you can keep it and build a <b>separate</b> profile (e.g. per category).
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                onClick={onScrapeExisting}
                loading={run.isPending}
                disabled={lock.locked || matchedProfile.listingUrls.length === 0}
              >
                {lock.locked ? 'Scraping…' : 'Scrape new products'}
              </Button>
              <Button size="sm" variant="secondary" onClick={onCreateNew}>
                Create new profile
              </Button>
              <Button size="sm" variant="ghost" onClick={onOverride}>
                Override existing
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-amber-200/70">
              <b>Scrape new products</b> runs the existing profile now. <b>Create new</b> builds a
              separate profile for this domain (existing one untouched). <b>Override</b> re-maps and
              overwrites the existing profile.
            </p>
          </div>
        )}
        {matchedProfile && profileMode === 'override' && (
          <p className="mt-3 text-[11px] text-warn">
            Overwriting <code className="font-mono">{matchedProfile.fileName}</code> on save.
          </p>
        )}
        {matchedProfile && profileMode === 'new' && (
          <p className="mt-3 text-[11px] text-accent">
            Creating a <b>new</b> profile for this domain — the existing one stays as-is.
          </p>
        )}
        </div>
      </div>
    </div>
  );
}

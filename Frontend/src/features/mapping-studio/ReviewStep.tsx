import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Play, FlaskConical } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { MappingDraft } from './types';
import {
  buildProfile,
  combineImageSelector,
  generalizeProductLink,
  productUrlPatternFromUrlPattern,
} from './types';
import { ScrapeProgress } from './ScrapeProgress';
import { TestResults } from './TestResults';

interface Props {
  draft: MappingDraft;
  onChange: (patch: Partial<MappingDraft>) => void;
  /** When set, Save writes to this exact file (edit or override). */
  saveFileName?: string | null;
  /** When true, Save creates a fresh (auto-suffixed) profile for the domain. */
  createNew?: boolean;
  /** True when editing an existing profile's mapping. */
  isEdit?: boolean;
}

/** Mirrors backend validateProfile so the user sees problems before saving. */
function validate(draft: MappingDraft): string[] {
  const errs: string[] = [];
  if (!draft.profileName.trim()) errs.push('Profile name is required.');
  if (!draft.domain.trim()) errs.push('Domain is required.');
  if (!draft.urlPattern.trim()) errs.push('URL pattern is required.');
  else {
    try {
      // eslint-disable-next-line no-new
      new RegExp(draft.urlPattern);
    } catch {
      errs.push('URL pattern is not a valid regex.');
    }
  }
  const title = draft.fields.find((f) => f.key === 'title');
  if (!title?.selector) errs.push('Title must be mapped (it is the required field).');
  return errs;
}

export function ReviewStep({ draft, onChange, saveFileName, createNew, isEdit }: Props) {
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [runStarted, setRunStarted] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [testLimit, setTestLimit] = useState(3);
  const [view, setView] = useState<'review' | 'results'>('review');

  // Fetch the URL pattern + dedupe check from the backend once we have a sample URL.
  const patternQuery = useMutation({
    mutationFn: (url: string) => api.getUrlPattern(url),
    onSuccess: (res) => {
      // Prefer a GENERALIZED product pattern (the whole slug is dynamic), so the
      // profile matches every product — not just the sampled one.
      const gen = generalizeProductLink(draft.sampleProductUrl || res.url);
      onChange({
        urlPattern: draft.urlPattern || gen?.urlPattern || res.pattern,
        domain: draft.domain || res.domain || '',
        productUrlPattern:
          draft.productUrlPattern ||
          gen?.productUrlPattern ||
          productUrlPatternFromUrlPattern(res.pattern),
      });
    },
  });

  // Auto-run the pattern generation when entering the step.
  useEffect(() => {
    const url = draft.sampleProductUrl || draft.listingUrl;
    if (url && !patternQuery.data && !patternQuery.isPending) patternQuery.mutate(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default the profile name to the domain once it's known (user can edit it).
  useEffect(() => {
    if (draft.domain.trim() && !draft.profileName.trim()) {
      onChange({ profileName: draft.domain });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.domain]);

  const save = useMutation({
    mutationFn: (runNow: boolean) => {
      const profile = buildProfile(
        { ...draft, productUrlPattern: draft.productUrlPattern },
        new Date().toISOString(),
      );
      // saveFileName → write that exact file (edit/override); createNew → backend
      // makes a fresh suffixed profile; else it derives from the domain.
      return api.saveProfile(saveFileName ?? null, profile, runNow, !!createNew);
    },
    onSuccess: (res) => {
      setSavedAs(res.fileName);
      setRunStarted(!!res.runStarted);
      setJobId(res.jobId ?? null);
    },
  });

  // Advisory test: scrape N sample products with the current mapping (no save).
  // On success, switch the step into the full-screen results view.
  const test = useMutation({
    mutationFn: () =>
      api.testProfile(
        buildProfile({ ...draft, productUrlPattern: draft.productUrlPattern }, new Date().toISOString()),
        testLimit,
      ),
  });
  const runTest = () => {
    setView('results'); // switch immediately → results screen shows the loader
    test.mutate();
  };

  const errors = validate(draft);
  const dupe = patternQuery.data?.match;
  const imagesSel = combineImageSelector(draft.images);

  // After "Save & Scrape now" → live animated progress screen.
  if (savedAs && jobId) {
    return <ScrapeProgress jobId={jobId} onBuildAnother={() => window.location.reload()} />;
  }

  // Test takes over the step as a full-screen, Products-style view — including
  // the loading + error states, so the user gets clear feedback (not just a
  // tiny button spinner) and stays on the screen.
  if (view === 'results') {
    return (
      <TestResults
        results={test.data?.results ?? []}
        found={test.data?.found ?? 0}
        fields={draft.fields}
        loading={test.isPending}
        limit={testLimit}
        error={test.isError ? (test.error as Error).message : null}
        onBack={() => setView('review')}
        onRetest={() => test.mutate()}
        retesting={test.isPending}
      />
    );
  }

  // After "Save only" → static confirmation.
  if (savedAs) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-900/30 text-accent">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-bold text-ink">Profile saved</h2>
        <p className="text-sm text-muted">
          Written to <code className="font-mono text-sky-300">{savedAs}</code>.{' '}
          {runStarted
            ? 'An initial crawl was started in the background — check Crawl History / Products shortly.'
            : 'The scraper will use it for matching product URLs.'}
          {draft.scrapeMode === 'auto'
            ? ' It will also re-crawl automatically on the schedule (with job).'
            : ' It is one-time — it won’t auto-crawl again.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => window.location.assign('/profiles')}>
            View profiles
          </Button>
          <Button onClick={() => window.location.reload()}>Build another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Meta form */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold text-ink">Profile details</h3>
        <div className="grid grid-cols-2 gap-4">
          <Labeled label="Profile name">
            <input
              className="input"
              value={draft.profileName}
              placeholder={`${draft.domain} Product Scraper`}
              onChange={(e) => onChange({ profileName: e.target.value })}
            />
          </Labeled>
          <Labeled label="Domain">
            <input
              className="input"
              value={draft.domain}
              onChange={(e) => onChange({ domain: e.target.value })}
            />
          </Labeled>
          <Labeled label="URL pattern (regex)" full>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                value={draft.urlPattern}
                onChange={(e) => onChange({ urlPattern: e.target.value })}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={patternQuery.isPending}
                onClick={() =>
                  patternQuery.mutate(draft.sampleProductUrl || draft.listingUrl)
                }
              >
                Regenerate
              </Button>
            </div>
          </Labeled>
        </div>

        {createNew && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/40 bg-emerald-900/20 p-3 text-xs text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Saving will create a <b>new</b> profile for this domain (existing profiles are kept). Give
              it a distinct name below — e.g. a category.
            </div>
          </div>
        )}
        {dupe && !createNew && !isEdit && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-amber-900/20 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              A profile already matches this URL:{' '}
              <code className="font-mono">{dupe.fileName}</code>
              {dupe.profileName ? ` (${dupe.profileName})` : ''}. Saving with the same domain will
              overwrite it.
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Labeled label="Scrape mode">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-panel2 p-1">
              {([
                { value: 'auto', label: 'With job' },
                { value: 'manual', label: 'One-time' },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ scrapeMode: m.value })}
                  className={
                    'rounded-md px-3 py-1.5 text-xs font-semibold ' +
                    (draft.scrapeMode === m.value ? 'bg-accent text-accent-ink' : 'text-muted')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Labeled>
          <Labeled label="Limit (new products / run)">
            <select
              className="input"
              value={draft.scrapeLimit ?? 'all'}
              onChange={(e) =>
                onChange({ scrapeLimit: e.target.value === 'all' ? null : Number(e.target.value) })
              }
            >
              <option value={10}>10 at a time</option>
              <option value={20}>20 at a time</option>
              <option value={50}>50 at a time</option>
              <option value={100}>100 at a time</option>
              <option value="all">All (no limit)</option>
            </select>
          </Labeled>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={draft.downloadImages}
              onChange={(e) => onChange({ downloadImages: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            Download images locally
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          <b>With job</b> = the scheduler re-crawls this profile automatically every interval.{' '}
          <b>One-time</b> = no background job; it runs once now and only again on demand. Either
          way, saving runs it once immediately. The <b>limit</b> caps how many new products are
          scraped each run — the rest stay queued for the next run.
        </p>
      </div>

      {/* Mapping summary */}
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink">Mapping summary</h3>
        <div className="space-y-1.5 text-xs">
          <SummaryRow
            label="Discovery"
            value={
              draft.discoveryMode === 'sitemap'
                ? `Sitemap${draft.sitemapUrl ? ` (${draft.sitemapUrl})` : ' (auto-detect)'}`
                : draft.discoveryMode === 'auto'
                  ? 'Auto (sitemap, fallback to listing crawl)'
                  : 'Crawl listing pages'
            }
            tag={draft.discoveryMode === 'listing' ? 'default' : 'sitemap'}
          />
          {draft.fields
            .filter((f) => f.selector)
            .map((f) => (
              <SummaryRow key={f.key} label={f.label} value={f.selector!} tag={f.required ? 'required' : f.type} />
            ))}
          {imagesSel && <SummaryRow label="Images" value={imagesSel} tag={`${draft.images.length} picked`} />}
          {draft.productLinkSelector && (
            <SummaryRow label="Product link" value={draft.productLinkSelector} tag="listing" />
          )}
          {draft.nextSelector && <SummaryRow label="Next page" value={draft.nextSelector} tag="pagination" />}
        </div>
      </div>

      {/* Errors + save */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-red-900/20 p-3 text-xs text-red-300">
          <div className="mb-1 font-semibold">Fix before saving:</div>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Advisory test: scrape a few real products and review them before saving. */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold text-ink">Test the mapping</h3>
          <p className="text-[11px] text-muted">
            Scrapes sample products with this mapping and opens a results screen so you can confirm the
            fields before saving.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input h-9 w-20"
            value={testLimit}
            onChange={(e) => setTestLimit(Number(e.target.value))}
            title="How many sample products to scrape"
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={errors.length > 0 || test.isPending}
            icon={<FlaskConical className="h-4 w-4" />}
            onClick={runTest}
          >
            Test {testLimit} products
          </Button>
        </div>
      </div>

      {save.isError && (
        <div className="rounded-lg border border-danger/40 bg-red-900/20 p-3 text-xs text-red-300">
          {(save.error as Error).message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          size="md"
          variant="secondary"
          disabled={errors.length > 0 || save.isPending}
          onClick={() => save.mutate(false)}
        >
          Save only
        </Button>
        <Button
          size="md"
          disabled={errors.length > 0 || save.isPending}
          icon={save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          onClick={() => save.mutate(true)}
        >
          Save &amp; Scrape now
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, tag }: { label: string; value: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <code className="flex-1 truncate font-mono text-sky-300" title={value}>
        {value}
      </code>
      <Badge tone="neutral">{tag}</Badge>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Save,
  Play,
  Trash2,
  Clock,
  CalendarClock,
  Images,
  AlertCircle,
  ExternalLink,
  Pencil,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  useCrawlHistory,
  useDeleteProfile,
  useRunProfile,
  useUpdateProfileSettings,
} from '@/hooks/useApi';
import { useScrapeLock } from '@/hooks/useScrapeLock';
import type { ProfileListItem, ScrapeMode } from '@/types/api';
import { formatDate, timeAgo, timeUntil } from '@/lib/format';

export function ProfileSettingsDrawer({
  profile,
  onClose,
}: {
  profile: ProfileListItem | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const update = useUpdateProfileSettings();
  const run = useRunProfile();
  const del = useDeleteProfile();
  const { data: hist } = useCrawlHistory(50);
  const scrapeLock = useScrapeLock(profile?.fileName ?? '');

  const [mode, setMode] = useState<ScrapeMode>('manual');
  const [limit, setLimit] = useState('');
  const [images, setImages] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form whenever a different profile is opened.
  useEffect(() => {
    if (!profile) return;
    setMode(profile.scrapeMode ?? 'manual');
    setLimit(profile.scrapeLimit != null ? String(profile.scrapeLimit) : '');
    setImages(!!profile.downloadImages);
    setPaused(!!profile.paused);
    setConfirmDelete(false);
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.fileName]);

  const limitValue = limit.trim() === '' ? null : Number(limit);

  // Dropdown choices; include the profile's current value if it's non-standard.
  const limitChoices = ['', '10', '20', '30', '50', '100'];
  if (limit && !limitChoices.includes(limit)) limitChoices.push(limit);

  const dirty =
    !!profile &&
    (mode !== (profile.scrapeMode ?? 'manual') ||
      limitValue !== (profile.scrapeLimit ?? null) ||
      images !== !!profile.downloadImages ||
      paused !== !!profile.paused);

  const canRun = !!profile && profile.listingUrls.length > 0 && !scrapeLock.locked;
  const recent = (hist?.history ?? [])
    .filter((h) => profile?.listingUrls.includes(h.listing_url))
    .slice(0, 6);

  const onSave = () => {
    if (!profile) return;
    update.mutate({
      fileName: profile.fileName,
      settings: { scrapeMode: mode, scrapeLimit: limitValue, downloadImages: images, paused },
    });
  };

  const onRun = () => {
    if (!profile) return;
    run.mutate(profile.fileName, { onSuccess: () => scrapeLock.lock() });
  };

  const onDelete = () => {
    if (!profile) return;
    del.mutate(profile.fileName, { onSuccess: onClose });
  };

  const actionsFooter = (
    <>
      {update.isError && (
        <p className="mb-2 flex items-center gap-1 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5" /> {(update.error as Error).message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Save className="h-4 w-4" />}
          onClick={onSave}
          loading={update.isPending}
          disabled={!dirty}
        >
          {update.isSuccess && !dirty ? 'Saved' : 'Save settings'}
        </Button>
        <Button
          variant="secondary"
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={onRun}
          loading={run.isPending}
          disabled={!canRun}
          title={
            scrapeLock.locked
              ? 'Scraping in progress — try again later'
              : profile && profile.listingUrls.length
                ? 'Crawl this profile now'
                : 'No listing URLs on this profile'
          }
        >
          {scrapeLock.locked ? 'Scraping…' : 'Scrape now'}
        </Button>
        {profile && profile.source !== 'api' && (
          <Button
            variant="ghost"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              onClose();
              navigate(`/scraper/new?edit=${encodeURIComponent(profile.fileName)}`);
            }}
            title="Edit field mapping (overwrites this profile on save)"
          >
            Edit fields
          </Button>
        )}
        <div className="ml-auto">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Delete this profile?</span>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={onDelete}
                loading={del.isPending}
              >
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Drawer
      open={!!profile}
      onClose={onClose}
      title={profile?.profileName || profile?.fileName || 'Profile'}
      subtitle={profile?.domain}
      footer={profile ? actionsFooter : undefined}
    >
      {!profile ? null : (
        <div className="space-y-6">
          {/* Identity + status */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={profile.source === 'api' ? 'api' : 'dom'}>{profile.source}</Badge>
            {profile.scrapeMode === 'auto' ? (
              <Badge tone={profile.paused ? 'warn' : 'yes'}>
                {profile.paused ? 'auto · paused' : 'with job'}
              </Badge>
            ) : profile.scrapeMode === 'manual' ? (
              <Badge tone="neutral">one-time</Badge>
            ) : (
              <Badge tone="warn">unset</Badge>
            )}
            <span className="text-xs text-muted">{profile.fieldCount} fields</span>
            {profile.hasImages && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Images className="h-3 w-3" /> images
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Last scraped"
              value={profile.lastScrapedAt ? timeAgo(profile.lastScrapedAt) : 'never'}
              sub={profile.lastScrapedAt ? formatDate(profile.lastScrapedAt) : undefined}
            />
            <Stat
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Next scrape"
              value={
                profile.scrapeMode === 'auto' && !paused && profile.nextScrapeAt
                  ? timeUntil(profile.nextScrapeAt)
                  : 'on demand'
              }
              sub={
                profile.scrapeMode === 'auto' && !paused && profile.nextScrapeAt
                  ? formatDate(profile.nextScrapeAt)
                  : 'manual / paused profiles run only when you trigger them'
              }
            />
          </div>

          {/* Settings */}
          <Section title="Settings">
            <Field label="Schedule mode">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'auto', label: 'Auto (with job)' },
                  { value: 'manual', label: 'Manual (one-time)' },
                ]}
              />
              <p className="mt-1 text-xs text-muted">
                Auto profiles are crawled automatically on the recurring schedule. Manual profiles
                only run when you click “Scrape now”.
              </p>
            </Field>

            {mode === 'auto' && (
              <Field label="Pause schedule">
                <Toggle
                  checked={paused}
                  onChange={setPaused}
                  label={paused ? 'Paused — excluded from the cron' : 'Active — included in the cron'}
                />
              </Field>
            )}

            <Field label="Scrape limit (new products per run)">
              <select
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="h-9 w-44 rounded-lg border border-line bg-panel2 px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-sky2/40"
              >
                {limitChoices.map((v) => (
                  <option key={v || 'all'} value={v}>
                    {v === '' ? 'All (no cap)' : `≤ ${v} / run`}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Images">
              <Toggle
                checked={images}
                onChange={setImages}
                label={images ? 'Download product images' : 'Skip image download'}
              />
            </Field>
          </Section>

          {/* Listing URLs */}
          <Section title={`Listing URLs (${profile.listingUrls.length})`}>
            {profile.listingUrls.length ? (
              <ul className="space-y-1">
                {profile.listingUrls.map((u) => (
                  <li key={u}>
                    <a
                      href={u}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 break-all text-xs text-sky2 hover:underline"
                    >
                      {u} <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">
                No listing URLs — rebuild this profile in the Mapping Studio to enable crawling.
              </p>
            )}
          </Section>

          {/* Recent crawls */}
          <Section title="Recent crawls">
            {recent.length ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <tbody>
                    {recent.map((h) => (
                      <tr key={h.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-muted">{formatDate(h.timestamp)}</td>
                        <td className="px-3 py-2 text-ink">+{h.new_products ?? 0} new</td>
                        <td className="px-3 py-2 text-emerald-300">{h.scraped_products ?? 0} scraped</td>
                        <td className="px-3 py-2 text-muted">{h.products_found ?? 0} found</td>
                        <td className="px-3 py-2">
                          <Badge tone={h.status === 'completed' ? 'yes' : h.status === 'failed' ? 'no' : 'neutral'}>
                            {h.status || '—'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted">No crawls recorded for this profile yet.</p>
            )}
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel2/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
        {icon} {label}
      </div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            value === o.value
              ? 'rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink'
              : 'rounded-md px-3 py-1.5 text-xs font-medium text-muted hover:text-ink'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2"
    >
      <span
        className={
          checked
            ? 'relative h-5 w-9 rounded-full bg-accent transition-colors'
            : 'relative h-5 w-9 rounded-full bg-line transition-colors'
        }
      >
        <span
          className={
            checked
              ? 'absolute left-[18px] top-0.5 h-4 w-4 rounded-full bg-white transition-all'
              : 'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-all'
          }
        />
      </span>
      <span className="text-xs text-muted">{label}</span>
    </button>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCode2, Play, Plus, Settings2, AlertCircle, PauseCircle, Tags } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useProfiles, useRunProfile, useActiveCrawls } from '@/hooks/useApi';
import type { ProfileListItem, ActiveCrawl } from '@/types/api';
import { timeAgo, timeUntil } from '@/lib/format';
import { ProfileSettingsDrawer } from './ProfileSettingsDrawer';
import { CategoryMappingModal } from '@/features/sync/CategoryMappingModal';

/** Normalize a URL to its bare host (drops protocol, www., trailing slash). */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** True when a running crawl (from /api/active-crawls) belongs to this profile. */
function isProfileCrawling(p: ProfileListItem, active: ActiveCrawl[]): boolean {
  const hosts = new Set(p.listingUrls.map(hostOf).filter(Boolean));
  if (p.domain) hosts.add(p.domain.replace(/^www\./, '').toLowerCase());
  if (!hosts.size) return false;
  return active.some((c) => c.listingUrls.some((u) => hosts.has(hostOf(u))));
}

export function ProfilesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useProfiles();
  const profiles = data?.profiles ?? [];
  const [selected, setSelected] = useState<ProfileListItem | null>(null);
  const [catMapFor, setCatMapFor] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Saved scraping profiles. Click a profile to change its settings, or run one on demand."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/scraper/new')}>
            New scraper
          </Button>
        }
      />

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !profiles.length ? (
            <EmptyState
              title="No profiles yet"
              hint="Build one in the visual Mapping Studio."
              icon={<FileCode2 className="h-5 w-5" />}
            />
          ) : (
            <Table>
              <THead>
                <TH>Profile</TH>
                <TH>Mode</TH>
                <TH>Last scraped</TH>
                <TH>Next scrape</TH>
                <TH className="text-right">Actions</TH>
              </THead>
              <TBody>
                {profiles.map((p) => (
                  <ProfileRow
                    key={p.fileName}
                    profile={p}
                    onOpen={() => setSelected(p)}
                    onMapCategories={() => setCatMapFor(p.fileName)}
                  />
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <ProfileSettingsDrawer profile={selected} onClose={() => setSelected(null)} />

      <CategoryMappingModal
        open={catMapFor != null}
        onClose={() => setCatMapFor(null)}
        profile={catMapFor ?? undefined}
      />
    </>
  );
}

function ProfileRow({
  profile: p,
  onOpen,
  onMapCategories,
}: {
  profile: ProfileListItem;
  onOpen: () => void;
  onMapCategories: () => void;
}) {
  const run = useRunProfile();
  const { data: activeData } = useActiveCrawls();
  // Real crawl state from /api/active-crawls — true while a job for this
  // profile's listing(s) is actually running.
  const isCrawling = isProfileCrawling(p, activeData?.active ?? []);
  const busy = isCrawling || run.isPending;
  const canRun = p.listingUrls.length > 0 && !busy;

  const onRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    run.mutate(p.fileName);
  };

  return (
    <TR className="cursor-pointer" onClick={onOpen}>
      <TD className="max-w-[300px]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{p.profileName || p.fileName}</span>
          <Badge tone={p.source === 'api' ? 'api' : 'dom'}>{p.source}</Badge>
        </div>
        <div className="truncate text-xs text-muted">{p.domain || p.fileName}</div>
      </TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {p.scrapeMode === 'auto' ? (
            p.paused ? (
              <Badge tone="warn">
                <PauseCircle className="mr-1 inline h-3 w-3" />
                paused
              </Badge>
            ) : (
              <Badge tone="yes">with job</Badge>
            )
          ) : p.scrapeMode === 'manual' ? (
            <Badge tone="neutral">one-time</Badge>
          ) : (
            <Badge tone="warn">unset</Badge>
          )}
          <Badge tone="info">{p.scrapeLimit ? `≤${p.scrapeLimit}/run` : 'all/run'}</Badge>
        </div>
      </TD>
      <TD className="whitespace-nowrap text-xs text-muted">
        {p.lastScrapedAt ? timeAgo(p.lastScrapedAt) : 'never'}
      </TD>
      <TD className="whitespace-nowrap text-xs text-muted">
        {p.scrapeMode === 'auto' && !p.paused && p.nextScrapeAt ? timeUntil(p.nextScrapeAt) : '—'}
      </TD>
      <TD>
        <div className="flex items-center justify-end gap-2">
          {run.isError && (
            <span
              className="flex items-center gap-1 text-xs text-danger"
              title={(run.error as Error).message}
            >
              <AlertCircle className="h-3.5 w-3.5" /> failed
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={<Play className="h-3.5 w-3.5" />}
            loading={busy}
            disabled={!canRun}
            onClick={onRun}
            title={
              isCrawling
                ? 'A crawl is currently running for this profile'
                : p.listingUrls.length
                  ? 'Crawl this profile now'
                  : 'No listing URLs on this profile'
            }
          >
            {busy ? 'Scraping…' : 'Scrape new'}
          </Button>
          {/* {p.source !== 'api' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/scraper/new?edit=${encodeURIComponent(p.fileName)}`);
              }}
              title="Edit field mapping (overwrites this profile on save)"
            >
              Edit fields
            </Button>
          )} */}
          <Button
            size="sm"
            variant="ghost"
            icon={<Tags className="h-3.5 w-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              onMapCategories();
            }}
            title="Map this profile's categories to the main site"
          >
            Categories
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Settings2 className="h-3.5 w-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="Profile settings"
          >
            Settings
          </Button>
        </div>
      </TD>
    </TR>
  );
}

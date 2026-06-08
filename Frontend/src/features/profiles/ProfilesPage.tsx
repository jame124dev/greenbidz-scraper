import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCode2, Play, Plus, Settings2, AlertCircle, PauseCircle, Tags } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useProfiles, useRunProfile } from '@/hooks/useApi';
import { useScrapeLock } from '@/hooks/useScrapeLock';
import type { ProfileListItem } from '@/types/api';
import { timeAgo, timeUntil } from '@/lib/format';
import { ProfileSettingsDrawer } from './ProfileSettingsDrawer';
import { CategoryMappingModal } from '@/features/sync/CategoryMappingModal';

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
  const { locked, lock } = useScrapeLock(p.fileName);
  const canRun = p.listingUrls.length > 0 && !locked;

  const onRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    run.mutate(p.fileName, { onSuccess: () => lock() });
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
            loading={run.isPending}
            disabled={!canRun}
            onClick={onRun}
            title={
              locked
                ? 'Scraping in progress — try again later'
                : p.listingUrls.length
                  ? 'Crawl this profile now'
                  : 'No listing URLs on this profile'
            }
          >
            {locked ? 'Scraping…' : 'Scrape new'}
          </Button>
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

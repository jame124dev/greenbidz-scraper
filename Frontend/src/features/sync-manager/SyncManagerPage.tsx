import { useSearchParams } from 'react-router-dom';
import { UploadCloud, History, Tags, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/cn';
import { NewSyncTab } from './NewSyncTab';
import { HistoryTab } from './HistoryTab';
import { MappingsTab } from './MappingsTab';
import { SettingsTab } from './SettingsTab';

type TabKey = 'new' | 'history' | 'mappings' | 'settings';

const TABS: { key: TabKey; label: string; icon: typeof UploadCloud }[] = [
  { key: 'new', label: 'New Sync', icon: UploadCloud },
  { key: 'history', label: 'History', icon: History },
  { key: 'mappings', label: 'Mappings', icon: Tags },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

export function SyncManagerPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'new';
  const setTab = (k: TabKey) => setParams({ tab: k }, { replace: true });

  return (
    <>
      <PageHeader
        title="Sync Management"
        description="Bulk-sync scraped products to the main site, track runs, and manage category mappings."
      />

      {/* Tab bar */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'new' && <NewSyncTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'mappings' && <MappingsTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

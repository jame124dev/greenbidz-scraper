import { useEffect, useState } from 'react';
import { Tags, SlidersHorizontal } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/states';
import { useSyncMeta } from '@/hooks/useApi';
import { CategoryMappingModal } from '@/features/sync/CategoryMappingModal';
import { FieldMappingModal } from '@/features/sync/FieldMappingModal';

export function MappingsTab() {
  const meta = useSyncMeta();
  const [marketplace, setMarketplace] = useState('');
  const [open, setOpen] = useState(false);
  const [openFields, setOpenFields] = useState(false);

  useEffect(() => {
    if (meta.data) setMarketplace((m) => m || meta.data.marketplaces[0]?.name || '');
  }, [meta.data]);

  if (meta.isLoading) return <LoadingState label="Loading marketplaces…" />;

  return (
    <Card>
      <CardBody className="space-y-4">
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-muted">Marketplace</span>
          <select className="input" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
            {(meta.data?.marketplaces ?? []).map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName} — {m.siteType}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-semibold text-ink">Category mappings</div>
            <p className="mt-0.5 mb-3 text-xs text-muted">
              Map each site’s scraped categories → main-site categories once. Sync runs then
              auto-select the right category for every product.
            </p>
            <Button icon={<Tags className="h-4 w-4" />} onClick={() => setOpen(true)} disabled={!marketplace}>
              Manage categories
            </Button>
          </div>

          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-semibold text-ink">Field mappings</div>
            <p className="mt-0.5 mb-3 text-xs text-muted">
              Choose which scraped field fills each main-site field (title, price, condition,
              brand, …). Leave a field on default to keep automatic mapping.
            </p>
            <Button
              variant="secondary"
              icon={<SlidersHorizontal className="h-4 w-4" />}
              onClick={() => setOpenFields(true)}
              disabled={!marketplace}
            >
              Manage fields
            </Button>
          </div>
        </div>
      </CardBody>

      <CategoryMappingModal open={open} onClose={() => setOpen(false)} marketplace={marketplace} />
      <FieldMappingModal open={openFields} onClose={() => setOpenFields(false)} marketplace={marketplace} />
    </Card>
  );
}

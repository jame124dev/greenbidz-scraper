import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useSyncMeta, useSourceFields, useFieldMappings, useSaveFieldMappings } from '@/hooks/useApi';

interface MetaRow {
  id: number;
  label: string;
  source: string;
}

/**
 * Map each main-site target field → the scraped SOURCE field it should be filled
 * from. Leaving a target on "default" keeps the internal auto-mapping. A separate
 * Metadata section bundles any number of scraped fields (checkbox quick-add +
 * custom-labelled rows) into the product's scrape_meta. Saved per marketplace and
 * reused on every sync run.
 */
export function FieldMappingModal({
  open,
  onClose,
  marketplace,
  profile,
  productIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  marketplace: string;
  profile?: string;
  productIds?: number[];
  onSaved?: () => void;
}) {
  const meta = useSyncMeta();
  const targetFields = meta.data?.targetFields ?? [];

  const srcQ = useSourceFields({ profile, productIds }, open);
  const mapQ = useFieldMappings(marketplace, open && !!marketplace);
  const save = useSaveFieldMappings();

  const sourceFields = srcQ.data?.fields ?? [];
  // picks: target_field → source_field ('' = use default)
  const [picks, setPicks] = useState<Record<string, string>>({});
  // metaRows: the scrape_meta bundle — each becomes a `meta:<label>` mapping.
  const [metaRows, setMetaRows] = useState<MetaRow[]>([]);
  const rowId = useRef(1);

  const seed = useMemo(
    () => () => {
      const next: Record<string, string> = {};
      for (const t of targetFields) next[t.key] = '';
      const metas: MetaRow[] = [];
      for (const m of mapQ.data?.mappings ?? []) {
        if (m.target_field.startsWith('meta:')) {
          metas.push({ id: rowId.current++, label: m.target_field.slice(5), source: m.source_field });
        } else {
          next[m.target_field] = m.source_field;
        }
      }
      setPicks(next);
      setMetaRows(metas);
    },
    [targetFields, mapQ.data],
  );
  useEffect(() => seed(), [seed]);

  // A source key that's mapped but no longer present in the scraped data still
  // needs to render as a selectable option so it isn't silently dropped on save.
  const sourceOptions = useMemo(() => {
    const opts = sourceFields.map((f) => ({ key: f.key, label: f.label, sample: f.sample }));
    const known = new Set(opts.map((o) => o.key));
    for (const v of Object.values(picks)) {
      if (v && !known.has(v)) {
        opts.push({ key: v, label: v, sample: '' });
        known.add(v);
      }
    }
    return opts;
  }, [sourceFields, picks]);

  const setPick = (target: string, source: string) =>
    setPicks((p) => ({ ...p, [target]: source }));

  // Metadata helpers.
  const sourceChecked = (key: string) => metaRows.some((r) => r.source === key);
  const toggleSource = (key: string, label: string) =>
    setMetaRows((rows) =>
      sourceChecked(key)
        ? rows.filter((r) => r.source !== key)
        : [...rows, { id: rowId.current++, label, source: key }],
    );
  const addCustomRow = () => setMetaRows((rows) => [...rows, { id: rowId.current++, label: '', source: '' }]);
  const updateRow = (id: number, patch: Partial<MetaRow>) =>
    setMetaRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) => setMetaRows((rows) => rows.filter((r) => r.id !== id));

  const mappedCount = Object.values(picks).filter(Boolean).length;
  const metaCount = metaRows.filter((r) => r.label.trim() && r.source).length;

  const onSave = () => {
    const desired: Record<string, string> = {};
    for (const t of targetFields) desired[t.key] = picks[t.key] || '';
    for (const r of metaRows) {
      const label = r.label.trim();
      if (label && r.source) desired[`meta:${label}`] = r.source;
    }
    // Include previously-saved keys so removed targets/meta entries get cleared.
    const prevKeys = (mapQ.data?.mappings ?? []).map((m) => m.target_field);
    const allKeys = new Set([...Object.keys(desired), ...prevKeys]);
    const mappings = [...allKeys].map((k) => ({ target_field: k, source_field: desired[k] || '' }));
    save.mutate(
      { siteType: marketplace, mappings },
      { onSuccess: () => { onSaved?.(); onClose(); } },
    );
  };

  const loading = meta.isLoading || mapQ.isLoading || srcQ.isLoading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-4xl"
      title="Map fields → scraped source"
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            {mappedCount} field{mappedCount === 1 ? '' : 's'} routed · {metaCount} in metadata
          </span>
          <Button variant="ghost" size="sm" onClick={seed} title="Revert unsaved changes">
            Reset
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={save.isPending} disabled={!targetFields.length} onClick={onSave}>
            Save mappings
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">
        Choose which scraped field fills each main-site field. Leave a field on
        <b className="text-ink"> Default</b> to keep automatic mapping. Per-product edits on the
        Sync page still override these.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-full" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-3 font-semibold">Main-site field</th>
                <th className="py-2 font-semibold">Scraped source field</th>
              </tr>
            </thead>
            <tbody>
              {targetFields.map((t) => {
                const pick = picks[t.key] ?? '';
                return (
                  <tr key={t.key} className="border-b border-line/60 align-top last:border-0">
                    <td className="py-2 pr-3 text-ink">
                      {t.label}
                      {t.defaultSource && (
                        <span className="ml-1.5 text-[11px] text-muted">default: {t.defaultSource}</span>
                      )}
                    </td>
                    <td className="py-2">
                      <select
                        className="input"
                        value={pick}
                        onChange={(e) => setPick(t.key, e.target.value)}
                      >
                        <option value="">— Default (automatic) —</option>
                        {sourceOptions.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                            {o.sample ? ` (e.g. ${o.sample})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── Metadata bundle (scrape_meta) ─────────────────────────────── */}
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-sm font-semibold text-ink">Metadata (scrape_meta)</div>
            <p className="mt-0.5 mb-2 text-xs text-muted">
              Check any scraped fields to bundle them into the product’s metadata, or add custom
              labelled entries. All selected fields are stored together as <code>scrape_meta</code>.
            </p>

            {/* Quick add: check multiple source fields at once. */}
            <div className="mb-3 flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-line bg-panel2 p-2">
              {sourceFields.length === 0 ? (
                <span className="text-xs text-muted">No scraped source fields discovered.</span>
              ) : (
                sourceFields.map((f) => (
                  <label key={f.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-accent"
                      checked={sourceChecked(f.key)}
                      onChange={() => toggleSource(f.key, f.label)}
                    />
                    {f.label}
                  </label>
                ))
              )}
            </div>

            {/* Editable rows (label + source), incl. custom ones. */}
            {metaRows.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-1.5 pr-3 font-semibold">Label (shown on listing)</th>
                    <th className="py-1.5 pr-3 font-semibold">Scraped source field</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {metaRows.map((r) => (
                    <tr key={r.id} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 pr-3">
                        <input
                          className="input"
                          value={r.label}
                          placeholder="e.g. Voltage"
                          onChange={(e) => updateRow(r.id, { label: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <select className="input" value={r.source} onChange={(e) => updateRow(r.id, { source: e.target.value })}>
                          <option value="">— select source —</option>
                          {sourceOptions.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                              {o.sample ? ` (e.g. ${o.sample})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="text-muted hover:text-danger"
                          title="Remove"
                          onClick={() => removeRow(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={addCustomRow}>
              Add custom field
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

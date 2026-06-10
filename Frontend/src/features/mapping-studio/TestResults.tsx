import { useState } from 'react';
import { ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, ImageIcon, ImageOff, ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { htmlToText } from '@/lib/html';
import type { TestProductResult } from '@/types/api';
import type { FieldDraft } from './types';

/** Value extracted for a given field key (rawData first, then top-level fallbacks). */
function fieldValue(r: TestProductResult, key: string): string {
  const raw = r.fields?.[key];
  if (raw != null && raw !== '') return String(raw);
  if (key === 'title') return r.title || '';
  if (key === 'price') return String(r.priceRaw ?? r.price ?? '');
  if (key === 'description') return r.description || '';
  return '';
}

/** A result is "complete" when every required, mapped field came back non-empty. */
function isComplete(r: TestProductResult, fields: FieldDraft[]): boolean {
  if (!r.ok) return false;
  return fields
    .filter((f) => f.selector && f.required)
    .every((f) => fieldValue(r, f.key).trim() !== '');
}

export function TestResults({
  results,
  found,
  fields,
  loading,
  limit = 3,
  error,
  onBack,
  onRetest,
  retesting,
}: {
  results: TestProductResult[];
  found: number;
  fields: FieldDraft[];
  loading?: boolean;
  limit?: number;
  error?: string | null;
  onBack: () => void;
  onRetest: () => void;
  retesting?: boolean;
}) {
  const [open, setOpen] = useState<TestProductResult | null>(null);
  const mappedFields = fields.filter((f) => f.selector);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} disabled={loading}>
            Back to review
          </Button>
          <span className="text-sm text-muted">
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                Scraping {limit} sample product{limit === 1 ? '' : 's'} with your mapping…
              </span>
            ) : error ? (
              <span className="text-danger">Test failed</span>
            ) : (
              <>
                Tested <b className="text-ink">{results.length}</b> of {found} found ·{' '}
                <span className="text-accent">{results.filter((r) => isComplete(r, fields)).length} complete</span>
              </>
            )}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={retesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          loading={retesting}
          disabled={loading}
          onClick={onRetest}
        >
          Re-test
        </Button>
      </div>

      {loading ? (
        <TestLoading limit={limit} />
      ) : error ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-6 w-6 text-danger" />
            <div className="text-sm text-ink">Couldn’t run the test</div>
            <div className="max-w-md text-xs text-muted">{error}</div>
            <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetest}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : (
      <Card>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TH className="w-12" />
              <TH>Product</TH>
              <TH>Price</TH>
              <TH>Fields</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {results.map((r, i) => {
                const complete = isComplete(r, fields);
                const filled = mappedFields.filter((f) => fieldValue(r, f.key).trim() !== '').length;
                return (
                  <TR key={i} className="cursor-pointer" onClick={() => setOpen(r)}>
                    <TD>
                      <Thumb src={r.images?.[0]} />
                    </TD>
                    <TD className="max-w-[360px]">
                      <div className="truncate font-medium text-ink">
                        {r.title || <span className="text-warn">⚠ no title</span>}
                      </div>
                      <div className="truncate text-xs text-muted">{r.url}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{r.priceRaw ?? r.price ?? <span className="text-warn">—</span>}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">
                      {filled}/{mappedFields.length} · {(r.images?.length ?? 0)} img
                    </TD>
                    <TD>
                      {!r.ok ? (
                        <Badge tone="no">error</Badge>
                      ) : complete ? (
                        <Badge tone="yes">
                          <CheckCircle2 className="mr-1 inline h-3 w-3" /> complete
                        </Badge>
                      ) : (
                        <Badge tone="warn">
                          <AlertTriangle className="mr-1 inline h-3 w-3" /> needs fields
                        </Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>
      )}

      <TestResultModal result={open} fields={fields} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Engaging loading state while the test scrape runs (it can take a bit). */
function TestLoading({ limit }: { limit: number }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div>
            <div className="text-sm font-medium text-ink">Scraping {limit} sample product{limit === 1 ? '' : 's'}…</div>
            <div className="text-xs text-muted">
              Loading the listing, then extracting fields from each product. This can take ~10–40s — hang tight.
            </div>
          </div>
        </div>
        {/* Skeleton rows mirroring the results table */}
        <div className="space-y-2">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-line p-2.5" style={{ opacity: 1 - i * 0.12 }}>
              <div className="skeleton h-10 w-10 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3.5 w-1/2 rounded" />
                <div className="skeleton h-3 w-3/4 rounded" />
              </div>
              <div className="skeleton h-5 w-16 rounded" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function TestResultModal({
  result: r,
  fields,
  onClose,
}: {
  result: TestProductResult | null;
  fields: FieldDraft[];
  onClose: () => void;
}) {
  const mappedFields = fields.filter((f) => f.selector);
  return (
    <Drawer open={!!r} onClose={onClose} title={r?.title || 'Test product'} subtitle={r?.url}>
      {!r ? null : !r.ok ? (
        <div className="rounded-lg border border-danger/30 bg-red-900/20 p-3 text-sm text-red-300">
          <div className="mb-1 font-semibold">Scrape failed</div>
          {r.error}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Gallery */}
          {r.images && r.images.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {r.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-32 w-32 shrink-0 rounded-lg border border-line object-cover"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-muted">
              <ImageOff className="mr-2 h-5 w-5" /> No images extracted
            </div>
          )}

          {/* Mapped fields + completeness */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Mapped fields</div>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <tbody>
                  {mappedFields.map((f) => {
                    const val = fieldValue(r, f.key);
                    const empty = val.trim() === '';
                    const text = f.type === 'html' || f.key === 'description' ? htmlToText(val) : val;
                    return (
                      <tr key={f.key} className="border-b border-line/60 align-top last:border-0">
                        <td className="w-40 px-3 py-2 text-xs text-muted">
                          {f.label}
                          {f.required && <span className="ml-1 text-danger">*</span>}
                        </td>
                        <td className="px-3 py-2">
                          {empty ? (
                            <span className={f.required ? 'text-danger' : 'text-muted'}>
                              {f.required ? '⚠ missing (required)' : '—'}
                            </span>
                          ) : (
                            <span className="whitespace-pre-wrap break-words text-ink">{text.slice(0, 600)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw extracted values */}
          {r.fields && Object.keys(r.fields).length > 0 && (
            <details className="rounded-lg border border-line bg-bg">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted">Raw extracted values</summary>
              <pre className="max-h-60 overflow-auto px-3 pb-3 font-mono text-[11px] text-muted">
                {JSON.stringify(r.fields, null, 2)}
              </pre>
            </details>
          )}

          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-sky2 hover:underline"
          >
            View source page <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </Drawer>
  );
}

function Thumb({ src }: { src?: string }) {
  if (!src) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-panel2 text-muted">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-panel2">
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
      />
    </div>
  );
}

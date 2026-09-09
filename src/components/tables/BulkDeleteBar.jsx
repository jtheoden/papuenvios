import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { semanticColors } from '@/lib/colorTokens';

const REASON_KEYS = {
  blocking_orders: 'tables.bulkDeleteReasonBlockingOrders',
  has_products: 'tables.bulkDeleteReasonHasProducts',
  not_found: 'tables.bulkDeleteReasonNotFound'
};

/**
 * Floating bulk-action bar + confirmation modal for super_admin bulk-delete.
 * Purely a UI shell — the caller supplies `onConfirmDelete(ids)` which must
 * call the actual RPC-backed service (bulkDeleteProducts/bulkDeleteCategories)
 * and return { deleted, blocked }.
 *
 * @prop {array} selectedIds
 * @prop {function} onClearSelection
 * @prop {function} onConfirmDelete - async (ids) => { deleted, blocked }
 * @prop {function} getItemLabel - (id) => string, used for the blocked-items report
 * @prop {function} [onPreview] - optional async (ids) => Array<{id, name, canDelete, blockReason, counts}>.
 *   When provided, fetched as soon as the confirm modal opens and rendered
 *   BEFORE the user types the confirmation word, so the cascade impact
 *   (related rows that will also be affected) is visible up front.
 */
const BulkDeleteBar = ({ selectedIds = [], onClearSelection, onConfirmDelete, onPreview, getItemLabel = (id) => id }) => {
  const { t } = useLanguage();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  const confirmWord = t('tables.bulkDeleteConfirmWord') || 'ELIMINAR';
  const count = selectedIds.length;

  if (count === 0) return null;

  const openConfirm = () => {
    setShowConfirm(true);
    if (onPreview) {
      setPreviewLoading(true);
      setPreviewError(false);
      onPreview(selectedIds)
        .then(setPreview)
        .catch(() => setPreviewError(true))
        .finally(() => setPreviewLoading(false));
    }
  };

  const closeConfirm = () => {
    setShowConfirm(false);
    setConfirmText('');
    setResult(null);
    setPreview(null);
    setPreviewError(false);
  };

  const formatCount = (key, n) => (t(key) || `${n}`).replace('{count}', n);

  const previewLine = (item) => {
    if (!item.canDelete) {
      return t(REASON_KEYS[item.blockReason]) || item.blockReason;
    }
    const parts = [];
    if (item.counts?.combosToDeactivate) parts.push(formatCount('tables.bulkDeletePreviewCombos', item.counts.combosToDeactivate));
    if (item.counts?.inventoryRows) parts.push(formatCount('tables.bulkDeletePreviewInventoryRows', item.counts.inventoryRows));
    if (item.counts?.inventoryMovements) parts.push(formatCount('tables.bulkDeletePreviewInventoryMovements', item.counts.inventoryMovements));
    if (item.counts?.products) parts.push(formatCount('tables.bulkDeletePreviewProducts', item.counts.products));
    return parts.length > 0 ? parts.join(', ') : (t('tables.bulkDeletePreviewNoImpact') || 'no related items');
  };

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const outcome = await onConfirmDelete(selectedIds);
      setResult(outcome);
      if (!outcome?.blocked?.length) {
        onClearSelection?.();
        closeConfirm();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-lg shadow-lg border px-4 py-3 flex items-center gap-3"
        style={{ borderColor: semanticColors.neutral[200] }}
      >
        <span className="text-sm font-medium" style={{ color: semanticColors.neutral[700] }}>
          {(t('tables.selectedCount') || '{count} selected').replace('{count}', count)}
        </span>
        <Button variant="outline" size="sm" onClick={onClearSelection}>
          <X className="h-4 w-4 mr-1" />
          {t('tables.clearSelection') || 'Clear'}
        </Button>
        <Button variant="destructive" size="sm" onClick={openConfirm}>
          <Trash2 className="h-4 w-4 mr-1" />
          {t('tables.deleteSelected') || 'Delete selected'}
        </Button>
      </motion.div>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeConfirm}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3" style={{ color: semanticColors.error?.main || '#DC2626' }}>
                <AlertTriangle className="h-5 w-5" />
                <h3 className="text-lg font-semibold">{t('tables.bulkDeleteConfirmTitle') || 'Confirm bulk delete'}</h3>
              </div>

              <p className="text-sm mb-4" style={{ color: semanticColors.neutral[700] }}>
                {(t('tables.bulkDeleteConfirmBody') || 'You are about to delete {count} item(s). This cannot be undone.').replace('{count}', count)}
              </p>

              {!result && onPreview && (
                <div className="mb-4 text-sm rounded border p-3 max-h-48 overflow-y-auto" style={{ borderColor: semanticColors.neutral[200] }}>
                  {previewLoading && (
                    <p style={{ color: semanticColors.neutral[500] }}>
                      {t('tables.bulkDeletePreviewLoading') || 'Calculating related items...'}
                    </p>
                  )}
                  {!previewLoading && previewError && (
                    <p className="text-amber-700">
                      {t('tables.bulkDeletePreviewError') || 'Could not calculate the delete impact.'}
                    </p>
                  )}
                  {!previewLoading && !previewError && preview && (
                    <>
                      <p className="font-medium mb-1" style={{ color: semanticColors.neutral[700] }}>
                        {t('tables.bulkDeletePreviewWillDelete') || 'Will be deleted, along with:'}
                      </p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {preview.map((item) => (
                          <li key={item.id} className={item.canDelete ? '' : 'text-amber-700'}>
                            {item.name || getItemLabel(item.id)} — {previewLine(item)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {!result && (
                <>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={t('tables.bulkDeleteConfirmInput') || `Type ${confirmWord} to confirm`}
                    className="w-full border rounded px-3 py-2 text-sm mb-4"
                    style={{ borderColor: semanticColors.neutral[300] }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={closeConfirm} disabled={isDeleting}>
                      {t('tables.bulkDeleteCancelButton') || 'Cancel'}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleConfirm}
                      disabled={confirmText.trim().toUpperCase() !== confirmWord.toUpperCase() || isDeleting}
                    >
                      {isDeleting ? '...' : (t('tables.bulkDeleteConfirmButton') || 'Delete permanently')}
                    </Button>
                  </div>
                </>
              )}

              {result && (
                <div className="space-y-2">
                  {result.deleted.length > 0 && (
                    <p className="text-sm text-green-700">
                      {(t('tables.bulkDeleteSuccess') || '{count} item(s) deleted').replace('{count}', result.deleted.length)}
                    </p>
                  )}
                  {result.blocked.length > 0 && (
                    <div className="text-sm text-amber-700">
                      <p className="font-medium">
                        {(t('tables.bulkDeleteBlocked') || '{count} item(s) could not be deleted').replace('{count}', result.blocked.length)}
                      </p>
                      <ul className="list-disc list-inside mt-1">
                        {result.blocked.map((b) => (
                          <li key={b.id}>
                            {getItemLabel(b.id)} — {t(REASON_KEYS[b.reason]) || b.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex justify-end pt-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        onClearSelection?.(result.blocked.map((b) => b.id));
                        closeConfirm();
                      }}
                    >
                      {t('tables.bulkDeleteCancelButton') || 'Close'}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default BulkDeleteBar;

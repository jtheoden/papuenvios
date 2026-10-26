import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  previewPurgeRefundProofs: vi.fn(),
  executePurgeRefundProofs: vi.fn(),
  getExpiringProofs: vi.fn()
}));
vi.mock('@/lib/refundService', () => svc);
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import RefundProofsMaintenance from '@/components/admin/RefundProofsMaintenance';

describe('RefundProofsMaintenance (inbox)', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
    svc.getExpiringProofs.mockResolvedValue({ count: 0, overdueUnpurged: 0 });
  });

  it('shows the "expiring soon" notice only when there is something', async () => {
    svc.getExpiringProofs.mockResolvedValue({ count: 4, overdueUnpurged: 2 });
    render(<RefundProofsMaintenance />);
    expect(await screen.findByText('refundAudit.expiring.warning|4')).toBeInTheDocument();
    expect(screen.getByText('refundAudit.expiring.overdue|2')).toBeInTheDocument();
  });

  it('hides the notice when the RPC is unavailable (null)', async () => {
    svc.getExpiringProofs.mockResolvedValue(null);
    render(<RefundProofsMaintenance />);
    await waitFor(() => expect(svc.getExpiringProofs).toHaveBeenCalledWith(30));
    expect(screen.queryByText(/refundAudit.expiring/)).toBeNull();
    expect(screen.getByRole('button', { name: 'refundAudit.purge.button' })).toBeInTheDocument();
  });

  it('previews first, then needs an explicit confirmation before executing with the previewed count', async () => {
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 3, capped: false });
    svc.executePurgeRefundProofs.mockResolvedValue({ purged: 3, skipped: 0, failed: 0 });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(svc.executePurgeRefundProofs).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('refundAudit.purge.confirmBody|3');
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.confirm|3' }));
    await waitFor(() => expect(svc.executePurgeRefundProofs).toHaveBeenCalledWith(3));
    expect(await screen.findByText('refundAudit.purge.done|3|0|0')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('puts the focus on Cancel, traps it inside the dialog, closes with Escape and returns the focus to the trigger', async () => {
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 2, capped: false });
    render(<RefundProofsMaintenance />);
    const trigger = screen.getByRole('button', { name: 'refundAudit.purge.button' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog');
    const cancel = screen.getByRole('button', { name: 'refundAudit.purge.cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(svc.executePurgeRefundProofs).not.toHaveBeenCalled();
  });

  it('keeps the trigger focusable (aria-disabled, not disabled) while the preview runs and ignores a second click', async () => {
    let resolve;
    svc.previewPurgeRefundProofs.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<RefundProofsMaintenance />);
    const trigger = screen.getByRole('button', { name: 'refundAudit.purge.button' });
    trigger.focus();
    fireEvent.click(trigger);
    const checking = await screen.findByRole('button', { name: 'refundAudit.purge.checking' });
    expect(checking).not.toBeDisabled();
    expect(checking).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(checking);
    fireEvent.click(checking);
    expect(svc.previewPurgeRefundProofs).toHaveBeenCalledTimes(1);
    resolve({ due: 0, capped: false });
    await screen.findByText('refundAudit.purge.none');
  });

  it('refreshes the "expiring soon" notice after a successful purge', async () => {
    svc.getExpiringProofs.mockResolvedValueOnce({ count: 3, overdueUnpurged: 3 }).mockResolvedValue({ count: 0, overdueUnpurged: 0 });
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 3, capped: false });
    svc.executePurgeRefundProofs.mockResolvedValue({ purged: 3, skipped: 0, failed: 0 });
    render(<RefundProofsMaintenance />);
    await screen.findByText('refundAudit.expiring.warning|3');
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.confirm|3' }));
    await waitFor(() => expect(screen.queryByText('refundAudit.expiring.warning|3')).toBeNull());
    expect(svc.getExpiringProofs).toHaveBeenCalledTimes(2);
  });

  it('shows the "forbidden" message when the function answers 401/403', async () => {
    svc.previewPurgeRefundProofs.mockRejectedValue({ context: { reason: 'not_authorized' } });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refundAudit.purge.forbidden');
  });

  it('cancel closes the dialog without executing', async () => {
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 2, capped: true });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    await screen.findByRole('alertdialog');
    expect(screen.getByText('refundAudit.purge.capped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(svc.executePurgeRefundProofs).not.toHaveBeenCalled();
  });

  it('says so and offers no confirmation when nothing is due', async () => {
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 0, capped: false });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    expect(await screen.findByText('refundAudit.purge.none')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for a new confirmation when the count changed (409)', async () => {
    svc.previewPurgeRefundProofs.mockResolvedValue({ due: 3, capped: false });
    svc.executePurgeRefundProofs.mockRejectedValue({ context: { reason: 'count_changed' } });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.confirm|3' }));
    expect(await screen.findByText('refundAudit.purge.countChanged')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows a visible error when the preview fails', async () => {
    svc.previewPurgeRefundProofs.mockRejectedValue({ context: { reason: 'purge_failed' } });
    render(<RefundProofsMaintenance />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.purge.button' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refundAudit.purge.failed');
  });
});

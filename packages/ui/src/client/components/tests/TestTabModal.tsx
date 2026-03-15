/**
 * TestTabModal — shown when the browser blocks the test tab popup.
 *
 * Provides an "Open Test Tab" button (user gesture context) so window.open()
 * succeeds, plus a hint to allow popups for the domain.
 */

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTestResultStore } from '../../stores/testResultStore';
import {
  getPendingTabUrl,
  resolveTestTabModal,
  rejectTestTabModal,
} from '../../lib/test-orchestrator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';

export function TestTabModal() {
  const show = useTestResultStore((s) => s.showTestTabModal);
  const [retryError, setRetryError] = useState(false);

  if (!show) return null;

  function handleOpenTab() {
    const url = getPendingTabUrl();
    if (!url) return;

    const win = window.open(url, '_blank');
    if (win) {
      setRetryError(false);
      resolveTestTabModal(win);
    } else {
      // Still blocked — show inline retry message
      setRetryError(true);
    }
  }

  function handleCancel() {
    setRetryError(false);
    rejectTestTabModal();
  }

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test Tab Required</DialogTitle>
          <DialogDescription>
            Your browser blocked the test tab popup. Click below to open it manually,
            or allow popups for <strong>{window.location.hostname}</strong> in your
            browser settings for a smoother experience.
          </DialogDescription>
        </DialogHeader>

        {retryError && (
          <p className="text-sm text-destructive">
            Popup still blocked. Please allow popups for this site in your browser settings,
            then try again.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleOpenTab}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Test Tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

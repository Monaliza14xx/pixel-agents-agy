import { useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  providerId: string;
  onChangeProvider: (id: string) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
  providerId,
  onChangeProvider,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const [stagedProvider, setStagedProvider] = useState<string | null>(null);

  const activeProvider = stagedProvider ?? providerId;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      {/* ── Agent Provider ─────────────────────────────── */}
      <div className="px-10 py-4 flex flex-col gap-2">
        <label className="text-xs text-text-muted uppercase tracking-wider font-semibold">
          Agent Provider
        </label>
        <div className="flex gap-2">
          <Button
            variant={activeProvider === 'claude' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setStagedProvider('claude')}
            className="flex-1"
          >
            Claude
          </Button>
          <Button
            variant={activeProvider === 'antigravity' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setStagedProvider('antigravity')}
            className="flex-1"
          >
            Antigravity
          </Button>
        </div>
        {stagedProvider && stagedProvider !== providerId && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-warning leading-tight">
              Switching provider will reset all running agent sessions.
            </p>
            <Button
              variant="accent"
              size="sm"
              onClick={() => {
                onChangeProvider(stagedProvider);
                setStagedProvider(null);
              }}
            >
              Switch to {stagedProvider === 'antigravity' ? 'Antigravity' : 'Claude'}
            </Button>
          </div>
        )}
      </div>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'openSessionsFolder' });
          onClose();
        }}
      >
        Open Sessions Folder
      </MenuItem>
      {activeProvider === 'antigravity' && (
        <MenuItem
          onClick={() => {
            transport.send({ type: 'openAntigravityApp' });
            onClose();
          }}
        >
          Open Antigravity
        </MenuItem>
      )}
      <MenuItem
        onClick={() => {
          transport.send({ type: 'exportLayout' });
          onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'importLayout' });
          onClose();
        }}
      >
        Import Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'addExternalAssetDirectory' });
          onClose();
        }}
      >
        Add Asset Directory
      </MenuItem>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="Watch All Sessions"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox
        label="Instant Detection (Hooks)"
        checked={hooksEnabled}
        onChange={onToggleHooksEnabled}
      />
      <Checkbox
        label="Always Show Labels"
        checked={alwaysShowOverlay}
        onChange={onToggleAlwaysShowOverlay}
      />
      <Checkbox label="Debug View" checked={isDebugMode} onChange={onToggleDebugMode} />
    </Modal>
  );
}

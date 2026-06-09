import * as fs from 'fs';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { LoadedAssets, LoadedCharacterSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import { antigravityProvider,claudeProvider } from './providers/index.js';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

type WsSend = (message: Record<string, unknown>) => void;

/** Async hook toggle side effect (install/uninstall + script copy). Provided by cli.ts. */
export type SetHooksEnabledSideEffect = (enabled: boolean) => Promise<void> | void;

/** Cached assets loaded at server startup. Sent to each WebSocket client on webviewReady. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

export interface ClientMessageContext {
  store: AgentStateStore;
  runtime?: AgentRuntime;
  cache: AssetCache | null;
  /** Initial workspace path for the CLI. */
  workspacePath?: string;
  /** Install/uninstall hooks side effect. Needs server url+token known only to cli.ts. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Support launching into an external terminal (standalone mode). */
  onLaunchAgent?: (folderPath?: string, bypassPermissions?: boolean) => void;
}

// ── Setting key constants (mirror adapters/vscode/constants.ts) ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
const KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
const KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';
const KEY_PROVIDER = 'pixel-agents.provider';

function getActiveProvider(ctx: ClientMessageContext) {
  const adapter = ctx.store.getAdapter();
  const providerId = adapter?.getSetting<string>(KEY_PROVIDER, 'claude');
  return providerId === 'antigravity' ? antigravityProvider : claudeProvider;
}

/**
 * Handle incoming ClientMessage from a WebSocket client.
 *
 * In standalone mode, the server is the authority for all state: assets,
 * layout, settings, agents. Assets are loaded once at startup and cached
 * in memory. Each connecting client receives the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { store, runtime } = ctx;
  const adapter = store.getAdapter();

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx);
      break;

    case 'saveLayout':
      if (msg.layout) {
        writeLayoutToFile(msg.layout as Record<string, unknown>);
      }
      break;

    case 'saveAgentSeats':
      if (msg.seats) {
        adapter?.saveSeats(
          msg.seats as Record<string, { palette?: number; hueShift?: number; seatId?: string }>,
        );
      }
      break;

    case 'setSoundEnabled':
      adapter?.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter?.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_ALWAYS_SHOW_LABELS, enabled);
      store.broadcast({ type: 'settingsLoaded', alwaysShowLabels: enabled });
      break;
    }

    case 'setWatchAllSessions': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_WATCH_ALL_SESSIONS, enabled);
      if (runtime) runtime.watchAllSessions.current = enabled;
      store.broadcast({ type: 'settingsLoaded', watchAllSessions: enabled });
      break;
    }

    case 'setHooksEnabled': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_HOOKS_ENABLED, enabled);
      if (runtime) runtime.hooksEnabled.current = enabled;
      void ctx.onSetHooksEnabled?.(enabled);
      store.broadcast({ type: 'settingsLoaded', hooksEnabled: enabled });
      break;
    }

    case 'setHooksInfoShown':
      adapter?.setSetting(KEY_HOOKS_INFO_SHOWN, true);
      store.broadcast({ type: 'settingsLoaded', hooksInfoShown: true });
      break;

    case 'closeAgent':
      if (runtime) {
        const id = msg.id as number;
        const agent = store.get(id);
        if (agent) {
          runtime.dismissalTracker.dismiss(agent.jsonlFile);
          runtime.removeAgent(id);
        }
      }
      break;

    case 'focusAgent':
      // The CLI does not have a foreground terminal concept like VS Code,
      // but we broadcast selection to sync UI state across tabs.
      store.broadcast({ type: 'agentSelected', id: msg.id });
      break;

    case 'requestDiagnostics': {
      const diagnostics: Array<Record<string, unknown>> = [];
      for (const [, agent] of store) {
        let jsonlExists = false;
        let fileSize = 0;
        try {
          const stat = fs.statSync(agent.jsonlFile);
          jsonlExists = true;
          fileSize = stat.size;
        } catch {
          /* file doesn't exist */
        }
        diagnostics.push({
          id: agent.id,
          status: agent.isWaiting ? 'waiting' : 'active',
          hookDelivered: agent.hookDelivered,
          projectDir: agent.projectDir,
          projectDirExists: fs.existsSync(agent.projectDir),
          jsonlFile: agent.jsonlFile,
          jsonlExists,
          fileSize,
          fileOffset: agent.fileOffset,
          lastDataAt: agent.lastDataAt,
          linesProcessed: agent.linesProcessed,
        });
      }
      send({ type: 'agentDiagnostics', agents: diagnostics });
      break;
    }

    case 'launchAgent':
      if (ctx.onLaunchAgent) {
        ctx.onLaunchAgent(msg.folderPath as string, msg.bypassPermissions as boolean);
      }
      break;

    case 'setProvider': {
      const providerId = msg.providerId as string;
      adapter?.setSetting(KEY_PROVIDER, providerId);
      const newProvider = providerId === 'antigravity' ? antigravityProvider : claudeProvider;
      if (runtime) {
        runtime.setProvider(newProvider);
        if (ctx.workspacePath) {
          runtime.startScanning(ctx.workspacePath);
        }
      }
      // Notify webview of new capabilities
      send({
        type: 'providerCapabilities',
        readingTools: [...newProvider.readingTools],
        subagentToolNames: [...newProvider.subagentToolNames],
      });
      break;
    }

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'exportLayout':
      // Handled client-side in the browser via Download link / File System Access API.
      // The server already persists layout.json automatically on 'saveLayout'.
      break;

    case 'importLayout':
      // The client reads the file and sends a 'saveLayout' message with the new content.
      break;

    case 'setAgentCustomName': {
      const id = msg.id as number;
      const name = msg.name as string;
      const names = adapter?.getSetting<Record<number, string>>('pixel-agents.customNames', {}) ?? {};
      if (name) {
        names[id] = name;
      } else {
        delete names[id];
      }
      adapter?.setSetting('pixel-agents.customNames', names);
      break;
    }

    default:
      if (debug) console.log(`[Pixel Agents] WS client: unhandled message type "${msg.type}"`);
      break;
  }
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { store, runtime, cache } = ctx;
  const adapter = store.getAdapter();
  const provider = getActiveProvider(ctx);

  // 1. Provider capabilities (must arrive before any agent messages)
  send({
    type: 'providerCapabilities',
    readingTools: [...provider.readingTools],
    subagentToolNames: [...provider.subagentToolNames],
  });

  // 2. Assets (from server cache, loaded at startup via pngjs)
  if (cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 3. Layout (saved file, or bundled default)
  const savedLayout = readLayoutFromFile();
  send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });

  // 4. Settings (from adapter, with sensible defaults when adapter is absent)
  const cfg = readConfig();
  const watchAllSessions = adapter?.getSetting(KEY_WATCH_ALL_SESSIONS, false) ?? false;
  const hooksEnabled = adapter?.getSetting(KEY_HOOKS_ENABLED, true) ?? true;
  const providerId = adapter?.getSetting(KEY_PROVIDER, 'claude') ?? 'claude';
  send({
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion: adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '',
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    watchAllSessions,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    hooksEnabled,
    hooksInfoShown: adapter?.getSetting(KEY_HOOKS_INFO_SHOWN, false) ?? false,
    providerId,
    externalAssetDirectories: cfg.externalAssetDirectories,
  });

  // Sync runtime refs with the persisted settings so scanners behave correctly
  // from the first tick after a server restart.
  if (runtime) {
    runtime.watchAllSessions.current = watchAllSessions;
    runtime.hooksEnabled.current = hooksEnabled;
  }

  // 5. Restore persisted external agents (standalone only; VS Code handles its own restore)
  runtime?.restoreExternalAgents();

  // 6. Existing agents (either just restored, or from VS Code adapter if present)
  const agentIds: number[] = [];
  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  for (const [id, agent] of store) {
    agentIds.push(id);
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
  }
  const seats = adapter?.loadSeats() ?? {};
  const customNames = adapter?.getSetting<Record<number, string>>('pixel-agents.customNames', {}) ?? {};
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta: seats,
    folderNames,
    externalAgents,
    customNames,
  });

  // 7. Current status/tools for existing agents
  sendCurrentAgentStatuses(store, send);
}

function sendCurrentAgentStatuses(store: AgentStateStore, send: WsSend): void {
  for (const [agentId, agent] of store) {
    // Re-send active tools
    for (const [toolId, status] of agent.activeToolStatuses) {
      const toolName = agent.activeToolNames.get(toolId) ?? '';
      send({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
        toolName,
      });
    }
    // Re-send waiting status
    if (agent.isWaiting) {
      send({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    } else {
      // Explicitly sync active state
      send({
        type: 'agentStatus',
        id: agentId,
        status: 'active',
      });
    }
    // Re-send team metadata
    if (agent.teamName) {
      send({
        type: 'agentTeamInfo',
        id: agentId,
        teamName: agent.teamName,
        agentName: agent.agentName,
        isTeamLead: agent.isTeamLead,
        leadAgentId: agent.leadAgentId,
        teamUsesTmux: agent.teamUsesTmux,
      });
    }
    // Re-send token usage
    if (agent.inputTokens > 0 || agent.outputTokens > 0) {
      send({
        type: 'agentTokenUsage',
        id: agentId,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
      });
    }
  }
}

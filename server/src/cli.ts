#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import { exec } from 'child_process';
import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
} from './assetLoader.js';
import type { AssetCache } from './clientMessageHandler.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { antigravityProvider,claudeProvider, copyHookScript } from './providers/index.js';
import { PixelAgentsServer } from './server.js';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

function getActiveProvider(adapter: FileStateAdapter) {
  const providerId = adapter.getSetting<string>('pixel-agents.provider', 'claude');
  return providerId === 'antigravity' ? antigravityProvider : claudeProvider;
}

// ── Argument parsing ──────────────────────────────────────────

interface CliArgs {
  port: number;
  host: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3100, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: 3100)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  // __dirname is .../dist/
  const distDir = __dirname;
  const extensionRoot = path.dirname(distDir);
  const staticDir = path.join(distDir, 'webview');

  console.log('\n  👾 Pixel Agents Visualizer\n');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = {
    characters: await loadCharacterSprites(distDir),
    floorTiles: await loadFloorTiles(distDir).then((t) => t?.sprites ?? null),
    wallTiles: await loadWallTiles(distDir).then((t) => t?.sets ?? null),
    furniture: await loadFurnitureAssets(distDir),
    defaultLayout: loadDefaultLayout(distDir),
  };
  const charCount = assetCache.characters?.characters.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: 'standalone' });
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    const provider = getActiveProvider(adapter);
    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, provider);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // onAgentRemoved side effect: stop the Claude process associated with the agent.
    // In standalone mode, we use pkill -f to find the process by its unique session ID.
    runtime.setLifecycleCallbacks({
      onAgentRemoved: (_id, agent) => {
        if (!agent.jsonlFile) return;

        if (debug)
          console.log(
            `[Pixel Agents] Attempting to stop process for session ${agent.sessionId?.slice(0, 8)}...`,
          );

        if (process.platform === 'win32') {
          // Windows: fallback to session-id match in command line
          if (agent.sessionId) {
            const cmd = `taskkill /F /FI "COMMANDLINE eq *${agent.sessionId}*"`;
            exec(cmd);
          }
        } else {
          // macOS/Linux: use lsof to find the PID of the process that has the JSONL open for writing.
          // This works even for agents NOT launched by Pixel Agents (e.g. manual terminals).
          exec(`lsof -t "${agent.jsonlFile}"`, (_err, stdout) => {
            const pids = stdout.trim().split('\n').filter(Boolean);
            if (pids.length > 0) {
              for (const pid of pids) {
                const nPid = parseInt(pid, 10);
                if (nPid === process.pid) continue; // Don't kill ourselves!
                try {
                  process.kill(nPid, 'SIGTERM');
                  if (debug) console.log(`[Pixel Agents] Sent SIGTERM to PID ${nPid}`);
                } catch (e) {
                  if (debug) console.log(`[Pixel Agents] Failed to kill PID ${nPid}: ${e}`);
                }
              }
            } else if (agent.sessionId) {
              // Fallback: search command line for session ID
              exec(`pkill -f "${agent.sessionId}"`);
            }
          });
        }
      },
    });

    // onSetHooksEnabled side effect: install/uninstall hooks when user toggles in UI.
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      const p = getActiveProvider(adapter);
      if (enabled) {
        await p.installHooks(`http://127.0.0.1:${currentConfig.port}`, currentConfig.token);
        if (p.id === 'claude') {
          copyHookScript(extensionRoot);
        }
        console.log(`[Pixel Agents] Hooks installed for ${p.displayName} (user toggle)`);
      } else {
        await p.uninstallHooks();
        console.log(`[Pixel Agents] Hooks uninstalled for ${p.displayName} (user toggle)`);
      }
    };

    const config = await server.start({
      store,
      runtime,
      embedded: false,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      workspacePath: cwd,
      onSetHooksEnabled,
      onLaunchAgent: (folderPath?: string, bypassPermissions?: boolean) => {
        const p = getActiveProvider(adapter);
        const sessionId = crypto.randomUUID();
        const launchCwd = folderPath || cwd;
        const launch = p.buildLaunchCommand?.(sessionId, launchCwd, { bypassPermissions });
        if (!launch) return;

        const cmdLine = [launch.command, ...launch.args].join(' ');
        console.log(`[Pixel Agents] Launching ${p.displayName} in external terminal: ${cmdLine}`);

        // Get project dir for log discovery
        const dirs = p.getSessionDirs?.(launchCwd) ?? [];
        if (dirs[0]) {
          const projectDir = dirs[0];
          const folderName = folderPath ? path.basename(folderPath) : path.basename(cwd);
          runtime.preAdoptSession(sessionId, projectDir, folderName);
        }

        if (process.platform === 'darwin') {
          // Open in a new iTerm2 window
          const script = `
            tell application "iTerm"
              activate
              create window with default profile
              tell current session of current window
                write text "cd '${launchCwd}' && stty echo && ${cmdLine}"
              end tell
            end tell
          `;
          exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        } else if (process.platform === 'win32') {
          // Windows: Open in a new cmd window
          exec(`start cmd.exe /k "cd /d \\"${launchCwd}\\" && ${cmdLine}"`);
        } else {
          console.warn('[Pixel Agents] External launch only supported on macOS via iTerm2 and Windows via cmd.exe');
        }
      },
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick
    runtime.hooksEnabled.current = adapter.getSetting('pixel-agents.hooksEnabled', true);
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so
    if (runtime.hooksEnabled.current) {
      try {
        const p = getActiveProvider(adapter);
        await p.installHooks(`http://127.0.0.1:${config.port}`, config.token);
        if (p.id === 'claude') {
          copyHookScript(extensionRoot);
        }
        console.log(`[Pixel Agents] Hooks installed for ${p.displayName}`);
      } catch (err) {
        console.error('[Pixel Agents] Failed to install hooks:', err);
      }
    }

    // Start scanning for external sessions (active provider's log directories)
    runtime.startScanning(cwd);

    console.log(`\n  Pixel Agents server running at http://${args.host}:${config.port}\n`);

    // ── Graceful shutdown ──
    function shutdown(): void {
      console.log('\nShutting down...');
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

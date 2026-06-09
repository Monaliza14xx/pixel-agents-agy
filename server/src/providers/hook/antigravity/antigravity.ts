import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.ts';
import { BASH_COMMAND_DISPLAY_MAX_LENGTH } from '../../../constants.js';
import { ANTIGRAVITY_TERMINAL_NAME_PREFIX } from './constants.js';

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'google_search':
    case 'WebSearch':
    case 'search_web':
      return 'Searching the web';
    case 'code_execution':
      return 'Executing code';
    case 'Read':
    case 'view_file':
      return `Reading ${base(inp.file_path ?? inp.AbsolutePath)}`;
    case 'Edit':
    case 'replace_file_content':
    case 'multi_replace_file_content':
      return `Editing ${base(inp.file_path ?? inp.TargetFile)}`;
    case 'Write':
    case 'write_to_file':
      return `Writing ${base(inp.file_path ?? inp.TargetFile)}`;
    case 'list_dir':
      return 'Listing directory';
    case 'grep_search':
      return 'Searching codebase';
    case 'Bash':
    case 'run_command': {
      const cmd = (inp.command ?? inp.CommandLine ?? '') as string;
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'ask_permission':
      return 'Requesting permission';
    case 'ask_question':
      return 'Asking a question';
    case 'invoke_subagent':
      return 'Invoking subagent';
    case 'define_subagent':
      return 'Defining subagent';
    case 'send_message':
      return 'Sending message';
    case 'read_url_content':
      return 'Reading URL content';
    case 'generate_image':
      return 'Generating image';
    default:
      return `Using ${toolName}`;
  }
}

function getSessionDirs(workspacePath: string): string[] {
  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  const dirName = path.basename(workspacePath);
  const workspaceDir = path.join(geminiTmpDir, dirName, 'chats');

  // Return the expected directory even if it doesn't exist yet
  return [workspaceDir];
}

function getAllSessionRoots(): string[] {
  return [
    path.join(os.homedir(), '.gemini', 'tmp'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain'),
    path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain'),
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'),
  ];
}

function getSessionFile(sessionId: string, projectDir: string): string {
  // Gemini naming: session-<ISO8601>-<sessionId>.jsonl
  // The filename uses the first 8 characters of the session UUID.
  const shortId = sessionId.includes('-') ? sessionId.split('-')[0] : sessionId.slice(0, 8);
  return path.join(projectDir, `session-*${shortId}.jsonl`);
}

function normalizeHookEvent(
  _raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  // For now, let's assume it matches Claude's hook format if they use the same hook script logic,
  // or return null if not used.
  return null;
}

function buildLaunchCommand(
  _sessionId: string,
  cwd: string,
  opts?: { bypassPermissions?: boolean; role?: string },
): { command: string; args: string[]; env?: Record<string, string> } {
  const args: string[] = [];
  if (opts?.bypassPermissions) {
    args.push('--dangerously-skip-permissions');
  }
  if (opts?.role === 'coding') {
    args.push('-i', 'You are an expert coding agent. Please help me with coding tasks.');
  }
  return { command: 'agy', args, env: { PWD: cwd } };
}

export const antigravityProvider: HookProvider = {
  kind: 'hook',
  id: 'antigravity',
  displayName: 'Antigravity',
  protocolVersion: 1,

  normalizeHookEvent,

  installHooks: () => Promise.resolve(),
  uninstallHooks: () => Promise.resolve(),
  areHooksInstalled: () => Promise.resolve(false),

  formatToolStatus,
  permissionExemptTools: new Set(['AskUserQuestion', 'ask_permission', 'ask_question']),
  subagentToolNames: new Set(['Agent', 'Task', 'invoke_subagent', 'define_subagent']),
  readingTools: new Set([
    'Read',
    'google_search',
    'WebSearch',
    'view_file',
    'grep_search',
    'search_web',
  ]),
  terminalNamePrefix: ANTIGRAVITY_TERMINAL_NAME_PREFIX,

  getSessionDirs,
  getAllSessionRoots,
  sessionFilePattern: '*.jsonl',
  getSessionFile,
  buildLaunchCommand,
};

/**
 * Antigravity-specific constants.
 */

export const ANTIGRAVITY_HOOK_SCRIPT_NAME = 'antigravity-hook.js';

export const ANTIGRAVITY_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'Stop',
  'PermissionRequest',
  'Notification',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
] as const;

export const ANTIGRAVITY_TERMINAL_NAME_PREFIX = 'Antigravity';

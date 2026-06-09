# Handoff: Antigravity IDE & Manager Integration, Transcript Parser Bug Fix, and Terminal Focus Sync

This document outlines the changes made to support integration with the Antigravity IDE and standalone Antigravity Manager, fix character statuses from being stuck in "Thinking...", and synchronize focusing on terminal sessions and desktop apps when clicking character sprites.

## Summary of Work Done

### 1. Antigravity IDE & Manager Sync Integration
- **[.antigravityrules](file:///Users/monaliza/Documents/ml-projects/pixel-agents/.antigravityrules)**: Created a project-level constitutional instructions file for Antigravity agents working on this repository.
- **`adapters/vscode/extension.ts`**:
  - Added a status bar item (`👾 Pixel Agents`) to open/focus the Pixel Agents panel.
  - Automatically sets the active provider to `'gemini'` when running inside the Antigravity IDE.
- **`adapters/vscode/PixelAgentsViewProvider.ts`**:
  - Automatically defaults settings and view state to `'gemini'` if the host app is Antigravity.
  - Added a message listener for `openAntigravityApp` that launches `/Applications/Antigravity.app` (or runs `open -a Antigravity`) using `childProcess.exec` on macOS.
  - Added `~/.gemini/antigravity/brain` and `~/.gemini/antigravity-ide/brain` to the global session roots list in `server/src/providers/hook/gemini/gemini.ts` to support syncing with the Antigravity Manager.
- **`server/src/fileWatcher.ts`**:
  - Added support for scanning nested `.system_generated/logs` subfolders (Antigravity storage structure) and extracting UUID prefixes as the agent's display name.

### 2. Antigravity Log Parser Support (Stuck "Thinking..." Fix)
- **`server/src/transcriptParser.ts`**:
  - Intercepted lines containing `record.step_index !== undefined` to process them with a custom Antigravity handler.
  - Implemented `processAntigravityRecord` to parse `USER_INPUT` (resets turn and starts active state), `PLANNER_RESPONSE` (extracts tool calls, starts tools synthetically), and tool execution results (matches results back to active tools).
  - Handles turn-end detection for `PLANNER_RESPONSE` records with no tool calls robustly, transitioning the character state back to `waiting`/`idle` and clearing active tools.
- **`server/src/providers/hook/gemini/gemini.ts`**:
  - Expanded `formatToolStatus` to format all Antigravity/Gemini specific tools (e.g. `list_dir`, `grep_search`, `view_file`, `replace_file_content`, `multi_replace_file_content`, `write_to_file`, `run_command`, `ask_permission`, `ask_question`, `invoke_subagent`, `define_subagent`, `send_message`, `generate_image`, `read_url_content`, etc.).
  - Added `invoke_subagent` and `define_subagent` to the subagent tool list.
- **`server/__tests__/antigravityTranscript.test.ts`**:
  - Created a comprehensive test suite covering the Antigravity log parser behavior, verifying active state transitions, tool start/done flow, and turning back to `waiting` (idle).

### 3. Character Click Terminal Matching & App Focusing
- **`adapters/vscode/PixelAgentsViewProvider.ts`**:
  - Updated the `focusAgent` message handler to support external terminal matching. It now searches `vscode.window.terminals` in the current editor window for any active terminal matching the agent's `sessionId`, `shortSessionId` (first 8 chars), `folderName`, or starts with the provider prefix (like `Gemini`).
  - If a matching terminal is found in the current IDE window, it focuses it immediately via `terminal.show()`.
  - If no matching terminal is found, it determines whether the session originated from the **Antigravity IDE** (`antigravity-ide` path) or the standalone **Antigravity Manager** (`antigravity` path), and focuses the correct application using `childProcess.exec('open -a "<AppName>"')`.
  - Resolved "link characters" (teammates and subagents) to their parent session so that clicking on them correctly focuses their lead agent's session.

### 4. CLI Browser-Opening Cleanup & ESLint Fixes
- **`server/src/cli.ts`**: Removed automatic browser opening on server startup (`exec("open ...")`), `--no-open` arguments, and help messages, so the visualizer server runs cleanly in IDE extension contexts.
- **`webview-ui/src/office/engine/characters.ts`**: Enclosed the `CharacterState.WALK` switch case in curly braces to fix ESLint's `no-case-declarations` rule.

### 5. Antigravity CLI Migration
- **CLI Installation**: Installed the official `agy` CLI using the `antigravity.google` installer script.
- **Provider Migration**: Renamed `geminiProvider` to `antigravityProvider` and moved its source file to `server/src/providers/hook/antigravity/antigravity.ts`.
- **Constants Update**: Updated hook events, script names, and terminal prefixes from `GEMINI_*` to `ANTIGRAVITY_*`.
- **Launch Command**: Modified `buildLaunchCommand` to execute just `agy` instead of `agy --session-id <UUID>`.
- **UI Adjustments**: Updated `SettingsModal.tsx` and `BottomToolbar.tsx` to display **"Antigravity"** instead of **"Gemini"** and switched internal ids from `gemini` to `antigravity`.

---

## Verification & Status

The workspace is in a fully clean, compiled, and functional state:
- Root type checking, formatting checks, and lint checks pass cleanly with no errors:
  ```bash
  npm run check-types
  npm run format:check
  npm run lint
  ```
- All 215 server unit tests pass successfully:
  ```bash
  npm run test
  ```
- Compiled and packaged the final extension using `npm run vsix`.

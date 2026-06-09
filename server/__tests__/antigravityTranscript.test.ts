import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { antigravityProvider } from '../src/providers/hook/antigravity/antigravity.js';
import { processTranscriptLine, setHookProvider } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-antigravity',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/work',
    jsonlFile: '/work/.system_generated/logs/transcript.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  } as AgentState;
}

describe('Antigravity Transcript Parser', () => {
  let store: AgentStateStore;
  let waitingTimers: Map<number, any>;
  let permissionTimers: Map<number, any>;
  let broadcastEvents: any[] = [];

  beforeEach(() => {
    store = new AgentStateStore();
    waitingTimers = new Map();
    permissionTimers = new Map();
    broadcastEvents = [];

    // Mock store's broadcast method to collect events
    store.broadcast = vi.fn((event) => {
      broadcastEvents.push(event);
    });

    // Set Gemini hook provider for tool status formatting
    setHookProvider(antigravityProvider);
  });

  it('handles USER_INPUT turning agent to active and resetting turn state', () => {
    const agent = createTestAgent({ isWaiting: true, hadToolsInTurn: true });
    store.set(1, agent);

    const userInputLine = JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-06-03T08:10:54Z',
      content: 'I need you to list the directory contents',
    });

    processTranscriptLine(1, userInputLine, store, waitingTimers, permissionTimers);

    expect(agent.isWaiting).toBe(false);
    expect(agent.hadToolsInTurn).toBe(false);
    expect(broadcastEvents).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'active',
    });
  });

  it('handles PLANNER_RESPONSE with tool calls to start tools and mark active', () => {
    const agent = createTestAgent();
    store.set(1, agent);

    const plannerResponseLine = JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-06-03T08:10:55Z',
      tool_calls: [
        {
          name: 'list_dir',
          args: {
            DirectoryPath: '"/work"',
            toolAction: '"Listing directory contents"',
            toolSummary: '"List directory contents"',
          },
        },
      ],
    });

    processTranscriptLine(1, plannerResponseLine, store, waitingTimers, permissionTimers);

    expect(agent.isWaiting).toBe(false);
    expect(agent.hadToolsInTurn).toBe(true);
    expect(agent.activeToolIds.has('list_dir-2')).toBe(true);
    expect(agent.activeToolNames.get('list_dir-2')).toBe('list_dir');
    expect(agent.activeToolStatuses.get('list_dir-2')).toBe('Listing directory');

    expect(broadcastEvents).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'active',
    });

    expect(broadcastEvents).toContainEqual({
      type: 'agentToolStart',
      id: 1,
      toolId: 'list_dir-2',
      status: 'Listing directory',
      toolName: 'list_dir',
      permissionActive: false,
      runInBackground: false,
    });
  });

  it('handles tool execution results to mark active tools as done', () => {
    const agent = createTestAgent();
    agent.activeToolIds.add('list_dir-2');
    agent.activeToolNames.set('list_dir-2', 'list_dir');
    agent.activeToolStatuses.set('list_dir-2', 'Listing directory');
    store.set(1, agent);

    vi.useFakeTimers();

    const toolResultLine = JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'LIST_DIRECTORY',
      status: 'DONE',
      created_at: '2026-06-03T08:10:57Z',
      content: '[]',
    });

    processTranscriptLine(1, toolResultLine, store, waitingTimers, permissionTimers);

    // active tool is removed immediately from tracking
    expect(agent.activeToolIds.has('list_dir-2')).toBe(false);

    // After done delay, agentToolDone is broadcast
    vi.advanceTimersByTime(300);

    expect(broadcastEvents).toContainEqual({
      type: 'agentToolDone',
      id: 1,
      toolId: 'list_dir-2',
    });

    vi.useRealTimers();
  });

  it('handles special tool results like CODE_ACTION to complete write_to_file', () => {
    const agent = createTestAgent();
    agent.activeToolIds.add('write_to_file-10');
    agent.activeToolNames.set('write_to_file-10', 'write_to_file');
    agent.activeToolStatuses.set('write_to_file-10', 'Writing /work/file.txt');
    store.set(1, agent);

    vi.useFakeTimers();

    const toolResultLine = JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'CODE_ACTION',
      status: 'DONE',
      created_at: '2026-06-03T08:11:00Z',
      content: 'Created file /work/file.txt',
    });

    processTranscriptLine(1, toolResultLine, store, waitingTimers, permissionTimers);

    expect(agent.activeToolIds.has('write_to_file-10')).toBe(false);
    vi.advanceTimersByTime(300);

    expect(broadcastEvents).toContainEqual({
      type: 'agentToolDone',
      id: 1,
      toolId: 'write_to_file-10',
    });

    vi.useRealTimers();
  });

  it('handles PLANNER_RESPONSE with no tool calls and status DONE to mark waiting', () => {
    const agent = createTestAgent({ isWaiting: false });
    agent.activeToolIds.add('view_file-5');
    agent.activeToolNames.set('view_file-5', 'view_file');
    store.set(1, agent);

    const turnEndLine = JSON.stringify({
      step_index: 6,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-06-03T08:12:00Z',
      content: 'I have finished looking at the file and have no more tools to run.',
    });

    processTranscriptLine(1, turnEndLine, store, waitingTimers, permissionTimers);

    expect(agent.isWaiting).toBe(true);
    expect(agent.activeToolIds.size).toBe(0);

    expect(broadcastEvents).toContainEqual({
      type: 'agentToolsClear',
      id: 1,
    });

    expect(broadcastEvents).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
    });
  });

  it('handles PLANNER_RESPONSE with no tool calls and missing status to mark waiting', () => {
    const agent = createTestAgent({ isWaiting: false });
    agent.activeToolIds.add('view_file-5');
    agent.activeToolNames.set('view_file-5', 'view_file');
    store.set(1, agent);

    const turnEndLine = JSON.stringify({
      step_index: 6,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-06-03T08:12:00Z',
      content: 'I have finished looking at the file and have no more tools to run.',
    });

    processTranscriptLine(1, turnEndLine, store, waitingTimers, permissionTimers);

    expect(agent.isWaiting).toBe(true);
    expect(agent.activeToolIds.size).toBe(0);

    expect(broadcastEvents).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
    });
  });
});

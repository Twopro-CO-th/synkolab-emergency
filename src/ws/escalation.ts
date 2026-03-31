/**
 * Escalation Engine — ring agents one-by-one, longest-idle first
 *
 * Used by intercom calls (Pi device → agents in project)
 * 1. Pi sends call_start → create call, start escalation
 * 2. Ring agent #1 (longest idle), wait 30s
 * 3. If no response → ring agent #2, etc.
 * 4. If all missed → mark call as missed
 * 5. If any agent accepts → cancel escalation, connect
 */

import { getRoom } from './rooms.js';

// ─── Types ───────────────────────────────────────────

interface AgentState {
  availableSince: number; // timestamp
  currentCallId?: string;
  projectIds: string[];
}

interface EscalationState {
  callId: string;
  projectId: string;
  roomName: string;
  callerName: string;
  agentOrder: string[];
  currentIndex: number;
  timer: ReturnType<typeof setTimeout>;
  ringTimeout: number;
  onMissed?: () => void;
}

// ─── State ───────────────────────────────────────────

const agentStates = new Map<string, AgentState>();
const escalations = new Map<string, EscalationState>();

// ─── Agent Queue ─────────────────────────────────────

export function registerAgent(userId: string, projectIds: string[]): void {
  agentStates.set(userId, {
    availableSince: Date.now(),
    projectIds,
  });
}

export function unregisterAgent(userId: string): void {
  agentStates.delete(userId);
}

export function setAgentBusy(userId: string, callId: string): void {
  const state = agentStates.get(userId);
  if (state) state.currentCallId = callId;
}

export function freeAgent(userId: string): void {
  const state = agentStates.get(userId);
  if (state) {
    state.currentCallId = undefined;
    state.availableSince = Date.now();
  }
}

export function getAvailableAgents(projectId: string): string[] {
  const room = getRoom();
  return Array.from(agentStates.entries())
    .filter(([_, s]) => !s.currentCallId)
    .filter(([_, s]) => s.projectIds.includes(projectId))
    .filter(([uid]) => room.isOnline(uid))
    .sort((a, b) => a[1].availableSince - b[1].availableSince)
    .map(([uid]) => uid);
}

export function getAgentProjectIds(userId: string): string[] {
  return agentStates.get(userId)?.projectIds || [];
}

// ─── Escalation Engine ──────────────────────────────

export function startEscalation(
  callId: string,
  projectId: string,
  roomName: string,
  callerName: string,
  ringTimeout = 30,
  onMissed?: () => void,
): void {
  cancelEscalation(callId);

  const agents = getAvailableAgents(projectId);
  if (agents.length === 0) {
    onMissed?.();
    return;
  }

  const state: EscalationState = {
    callId, projectId, roomName, callerName,
    agentOrder: agents,
    currentIndex: 0,
    ringTimeout,
    onMissed,
    timer: setTimeout(() => {}, 0),
  };
  escalations.set(callId, state);
  ringNextAgent(state);
}

function ringNextAgent(state: EscalationState): void {
  if (state.currentIndex >= state.agentOrder.length) {
    escalations.delete(state.callId);
    state.onMissed?.();
    return;
  }

  const agentId = state.agentOrder[state.currentIndex];
  const room = getRoom();

  const sent = room.sendTo(agentId, {
    type: 'incoming_call',
    callId: state.callId,
    callerId: 'device',
    roomName: state.roomName,
    callerName: state.callerName,
    callType: 'intercom' as const,
    projectId: state.projectId,
    timeout: state.ringTimeout,
    agentIndex: state.currentIndex + 1,
    totalAgents: state.agentOrder.length,
  });

  if (!sent) {
    state.currentIndex++;
    ringNextAgent(state);
    return;
  }

  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    // Timeout — notify agent and try next
    room.sendTo(agentId, { type: 'call_timeout', callId: state.callId });
    state.currentIndex++;
    ringNextAgent(state);
  }, state.ringTimeout * 1000);
}

export function cancelEscalation(callId: string): void {
  const state = escalations.get(callId);
  if (state) {
    clearTimeout(state.timer);
    escalations.delete(callId);
  }
}

export function isEscalating(callId: string): boolean {
  return escalations.has(callId);
}

// ─── Broadcast to project agents ────────────────────

export function broadcastToProjectAgents(
  projectId: string,
  msg: Record<string, unknown>,
  excludeUserId?: string,
): void {
  const room = getRoom();
  for (const [userId, state] of agentStates) {
    if (userId === excludeUserId) continue;
    if (state.projectIds.includes(projectId)) {
      room.sendTo(userId, msg);
    }
  }
}

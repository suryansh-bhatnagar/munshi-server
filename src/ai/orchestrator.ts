/**
 * orchestrator.ts — The Single Entry Point for Munshi AI
 * 
 * KEY FIX: Uses markModified() for Mongoose Mixed type fields.
 * Without this, Mongoose silently ignores changes to contextData 
 * when saving, causing state to be lost between messages.
 */

import ChatSession from '../models/ChatSession';
import { classifyIntent, extractEntities, answerQuery } from './llm';
import { runStateMachine, pivotToPurchase } from './stateMachine';

export interface MunshiResponse {
  text: string;
  sessionId: string;
}

export async function processMessage(message: string, userId: string, sessionId?: string): Promise<MunshiResponse> {
  // ── 1. Load or Create Session ─────────────────────────────────────────
  let session;

  if (sessionId) {
    session = await ChatSession.findById(sessionId);
    if (!session || session.user.toString() !== userId) {
      session = null;
    }
  }

  if (!session) {
    session = new ChatSession({ user: userId, state: 'idle', contextData: {}, messages: [] });
    await session.save();
  }

  // ── 2. Log User Message ───────────────────────────────────────────────
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });

  let responseText: string;

  try {
    if (session.state === 'idle') {
      responseText = await handleIdleState(session, message, userId);
    } else {
      responseText = await handleActiveWorkflow(session, message, userId);
    }
  } catch (error: any) {
    console.error('Orchestrator error:', error.message, error.stack);
    responseText = getErrorMessage(error);

    // Only reset state for permanent/unknown errors.
    // For transient errors (quota, rate limit, network), keep the state
    // so the user can retry without losing their workflow.
    if (!isTransientError(error)) {
      session.state = 'idle';
      session.contextData = {};
    }
  }

  // ── 3. Log Response, Mark Modified, Save ──────────────────────────────
  session.messages.push({ role: 'assistant', content: responseText, timestamp: new Date() });

  if (session.messages.length > 50) {
    session.messages = session.messages.slice(-50);
  }

  // CRITICAL: Mongoose doesn't detect changes to Mixed type fields.
  // Without markModified(), contextData changes are silently lost on save.
  session.markModified('contextData');
  session.markModified('state');
  session.markModified('messages');
  await session.save();

  return { text: responseText, sessionId: session._id.toString() };
}

// ─── Idle State ─────────────────────────────────────────────────────────────

async function handleIdleState(session: any, message: string, userId: string): Promise<string> {
  const intent = await classifyIntent(message, 'idle');
  console.log(`[Orchestrator] Intent classified: ${intent}`);

  switch (intent) {
    case 'sale':
    case 'purchase':
      return await startInvoiceWorkflow(session, message, intent, userId);
    case 'query':
    default:
      return await answerQuery(message);
  }
}

// ─── Active Workflow ────────────────────────────────────────────────────────

async function handleActiveWorkflow(session: any, message: string, userId: string): Promise<string> {
  const intent = await classifyIntent(message, session.state);
  console.log(`[Orchestrator] State: ${session.state}, Intent: ${intent}`);

  // Cancel from any state
  if (intent === 'cancellation') {
    session.state = 'idle';
    session.contextData = {};
    return '🚫 Cancelled. How else can I help you?';
  }

  // Insufficient stock → pivot to purchase
  if (session.state === 'sale:insufficient_stock') {
    if (intent === 'confirmation') {
      const pivot = pivotToPurchase(session.contextData);
      session.state = pivot.nextState;
      session.contextData = pivot.contextData;

      if (!session.contextData.draft?.partyName) {
        return '🔄 Let\'s create a purchase invoice to restock.\n\nWho is the **supplier** you want to purchase from?';
      }

      return await executeStateMachine(session, message, userId);
    }
    // If not confirmation, assume they want to cancel
    session.state = 'idle';
    session.contextData = {};
    return '🚫 Sale cancelled. How else can I help you?';
  }

  // Confirm → execute invoice
  if ((session.state === 'sale:confirm' || session.state === 'purchase:confirm') && intent === 'confirmation') {
    return await executeStateMachine(session, message, userId);
  }

  // Waiting for supplier name after pivot
  if (session.state === 'purchase:verify_party' && session.contextData?.draft && !session.contextData.draft.partyName) {
    const entities = await extractEntities(message, 'User is providing a supplier name');
    session.contextData.draft.partyName = entities.partyName || message.trim();
    return await executeStateMachine(session, message, userId);
  }

  // All other states → state machine
  return await executeStateMachine(session, message, userId);
}

// ─── Execute State Machine (shared helper) ──────────────────────────────────

async function executeStateMachine(session: any, message: string, userId: string): Promise<string> {
  const result = await runStateMachine(session.state, session.contextData, message, userId);
  session.state = result.nextState;
  session.contextData = result.contextData;
  return result.response;
}

// ─── Start Invoice Workflow ─────────────────────────────────────────────────

async function startInvoiceWorkflow(session: any, message: string, type: 'sale' | 'purchase', userId: string): Promise<string> {
  const entities = await extractEntities(message);
  console.log(`[Orchestrator] Extracted entities:`, entities);

  if (!entities.partyName && (!entities.items || entities.items.length === 0)) {
    return type === 'sale'
      ? 'I\'d love to help you record a sale! Please tell me **who** you sold to and **what items** (with quantities).\n\nFor example: *"I sold 5 keyboards to John"*'
      : 'I\'d love to help you record a purchase! Please tell me **who** you bought from and **what items** (with quantities).\n\nFor example: *"I bought 10 boxes of screws from SupplierX"*';
  }

  session.contextData = {
    type,
    draft: {
      partyName: entities.partyName || '',
      items: entities.items || [],
      amountPaid: entities.amountPaid || 0,
    },
    verifiedItems: [],
  };

  if (!entities.partyName) {
    session.state = `${type}:verify_party`;
    return `Got it! I have the items. Who is the **${type === 'sale' ? 'customer' : 'supplier'}**?`;
  }

  if (!entities.items || entities.items.length === 0) {
    session.state = `${type}:verify_party`;
    return `Got it! The ${type === 'sale' ? 'customer' : 'supplier'} is **${entities.partyName}**. What **items** did you ${type === 'sale' ? 'sell' : 'buy'} (with quantities)?`;
  }

  // We have everything → enter state machine
  session.state = `${type}:verify_party`;
  return await executeStateMachine(session, message, userId);
}

// ─── Error Helpers ──────────────────────────────────────────────────────────

function isTransientError(error: any): boolean {
  const code = error?.status || error?.error?.code;
  const msg = (error?.message || '').toLowerCase();

  return (
    code === 429 || code === 503 ||
    msg.includes('quota') || msg.includes('rate') ||
    msg.includes('overloaded') || msg.includes('resource_exhausted') ||
    msg.includes('econnrefused') || msg.includes('timeout') ||
    msg.includes('network')
  );
}

function getErrorMessage(error: any): string {
  const code = error?.status || error?.error?.code;
  const msg = (error?.message || '').toLowerCase();

  // Quota exceeded
  if (code === 429 || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return '⚠️ **AI quota limit reached.** The free tier daily limit has been exceeded.\n\nYour workflow is saved — you can **try again later** and I\'ll pick up where we left off. Alternatively, upgrade the API plan for higher limits.';
  }

  // API overloaded
  if (code === 503 || msg.includes('overloaded')) {
    return '⏳ **AI service is temporarily overloaded.** Please try again in a few seconds.\n\nDon\'t worry — your current workflow is saved.';
  }

  // Network errors
  if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('network') || msg.includes('fetch')) {
    return '🌐 **Network error.** Could not connect to the AI service. Please check your internet connection and try again.\n\nYour workflow is saved.';
  }

  // MongoDB / database errors
  if (msg.includes('mongo') || msg.includes('e11000') || msg.includes('duplicate key')) {
    return '🗄️ **Database error:** A duplicate entry was detected. This item or record may already exist. Please try with different details.';
  }

  // Invalid API key
  if (code === 401 || code === 403 || msg.includes('api key') || msg.includes('unauthorized')) {
    return '🔑 **AI authentication failed.** The API key may be invalid or expired. Please contact the administrator.';
  }

  // Fallback
  return '❌ Something unexpected went wrong. Please try again. If the issue persists, try closing and reopening the chat.';
}

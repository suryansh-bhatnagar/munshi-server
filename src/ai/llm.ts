/**
 * llm.ts — Pure LLM Utility Layer
 * 
 * The LLM's only job is to UNDERSTAND language.
 * No business logic, no database access, no decision-making.
 * Includes retry logic for API overload errors.
 */

import { GoogleGenAI, Type } from '@google/genai';
import Customer from '../models/Customer';
import Supplier from '../models/Supplier';
import Item from '../models/Item';
import Invoice from '../models/Invoice';

const MODEL = 'gemini-3.6-flash';

const getAI = () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

// ─── Retry Wrapper ──────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isOverload = error?.status === 503 || error?.status === 429 || 
        error?.message?.includes('overloaded') || error?.message?.includes('rate');
      if (isOverload && attempt < maxRetries) {
        console.log(`[LLM] API overloaded, retrying (${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// ─── Intent Classification ──────────────────────────────────────────────────

export type Intent = 'sale' | 'purchase' | 'query' | 'confirmation' | 'cancellation' | 'provide_details';

export async function classifyIntent(message: string, currentState: string): Promise<Intent> {
  const ai = getAI();

  const stateContext = currentState !== 'idle'
    ? `The user is currently in the middle of a workflow (state: "${currentState}"). If they are providing requested information (like a phone number, price, name, etc.), classify as "provide_details". If they are agreeing/confirming, classify as "confirmation". If they are refusing/cancelling, classify as "cancellation".`
    : '';

  const response = await withRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: message,
    config: {
      systemInstruction: `You are an intent classifier for an accounting application called Munshi.
Classify the user's message into exactly ONE of these intents:
- "sale": User wants to record a sale/selling something
- "purchase": User wants to record a purchase/buying something  
- "query": User is asking a question about their data (inventory, customers, balances, etc.)
- "confirmation": User is confirming/agreeing (yes, ok, sure, confirm, proceed)
- "cancellation": User is cancelling/refusing (no, cancel, stop, nevermind)
- "provide_details": User is providing information that was requested (phone number, price, name, etc.)

${stateContext}

Respond with ONLY the intent string, nothing else.`,
      temperature: 0.1,
    }
  }));

  const text = (response.text || '').trim().toLowerCase().replace(/['"]/g, '');
  const validIntents: Intent[] = ['sale', 'purchase', 'query', 'confirmation', 'cancellation', 'provide_details'];
  
  if (validIntents.includes(text as Intent)) return text as Intent;
  
  // Fallback: if we're in a non-idle state, treat as provide_details
  if (currentState !== 'idle') return 'provide_details';
  return 'query';
}

// ─── Entity Extraction ──────────────────────────────────────────────────────

export interface ExtractedEntities {
  partyName?: string;
  items?: { name: string; quantity: number; price?: number }[];
  amountPaid?: number;
  phone?: string;
  email?: string;
  sellingPrice?: number;
  purchasePrice?: number;
  primaryUnit?: string;
  stockQuantity?: number;
}

export async function extractEntities(message: string, context?: string): Promise<ExtractedEntities> {
  const ai = getAI();

  const response = await withRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: context ? `Context: ${context}\n\nUser message: ${message}` : message,
    config: {
      systemInstruction: `You are an entity extractor for an accounting application.
Extract structured data from the user's message. Return a JSON object with any of these fields that are present:
- partyName (string): customer or supplier name
- items (array): each with { name, quantity, price? }
- amountPaid (number): amount paid upfront
- phone (string): phone number (any length)
- email (string): email address
- sellingPrice (number): selling price of an item
- purchasePrice (number): purchase/cost price of an item
- primaryUnit (string): unit of measurement (e.g., "packet", "kg", "piece", "PCS", "box")
- stockQuantity (number): initial stock quantity

IMPORTANT: Only include fields that are explicitly mentioned or clearly implied. Do NOT guess or make up values.
Return ONLY valid JSON, no markdown, no explanation.`,
      temperature: 0.1,
    }
  }));

  try {
    const text = (response.text || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ─── Query Answering (Gemini Function Calling) ──────────────────────────────

const queryTools: any = [{
  functionDeclarations: [
    {
      name: 'getCustomers',
      description: 'Get customers. Optionally filter by name.',
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING, description: 'Optional name filter' } }
      }
    },
    {
      name: 'getSuppliers',
      description: 'Get suppliers. Optionally filter by name.',
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING, description: 'Optional name filter' } }
      }
    },
    {
      name: 'getInventory',
      description: 'Get inventory items. Optionally filter by name.',
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING, description: 'Optional name filter' } }
      }
    },
    {
      name: 'getSales',
      description: 'Get recent sales invoices.',
      parameters: { type: Type.OBJECT, properties: {} }
    },
    {
      name: 'getPurchases',
      description: 'Get recent purchase invoices.',
      parameters: { type: Type.OBJECT, properties: {} }
    },
  ]
}];

const queryFunctions: Record<string, (args: any) => Promise<any>> = {
  getCustomers: async ({ name }: any = {}) => {
    const filter = name ? { name: new RegExp(name, 'i') } : {};
    const customers = await Customer.find(filter).limit(10);
    return customers.map(c => ({ name: c.name, phone: c.phone, balance: c.outstandingBalance }));
  },
  getSuppliers: async ({ name }: any = {}) => {
    const filter = name ? { name: new RegExp(name, 'i') } : {};
    const suppliers = await Supplier.find(filter).limit(10);
    return suppliers.map(s => ({ name: s.name, phone: s.phone, balance: s.outstandingBalance }));
  },
  getInventory: async ({ name }: any = {}) => {
    const filter = name ? { name: new RegExp(name, 'i') } : {};
    const items = await Item.find(filter).limit(10);
    return items.map(i => ({ name: i.name, stock: i.stockQuantity, sellingPrice: i.sellingPrice, purchasePrice: i.purchasePrice, unit: i.primaryUnit }));
  },
  getSales: async () => {
    const invoices = await Invoice.find({ type: 'sale' }).sort({ createdAt: -1 }).limit(10);
    return invoices.map(i => ({ number: i.invoiceNumber, party: i.partyName, total: i.grandTotal, status: i.status, date: i.date }));
  },
  getPurchases: async () => {
    const invoices = await Invoice.find({ type: 'purchase' }).sort({ createdAt: -1 }).limit(10);
    return invoices.map(i => ({ number: i.invoiceNumber, party: i.partyName, total: i.grandTotal, status: i.status, date: i.date }));
  },
};

export async function answerQuery(message: string): Promise<string> {
  const ai = getAI();

  const systemInstruction = `You are Munshi, an intelligent AI accounting assistant.
Answer the user's question about their business data using the available tools.
Format your responses using Markdown for readability (use tables for lists, bold for emphasis).
Be concise and helpful.`;

  let response = await withRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: message,
    config: { systemInstruction, tools: queryTools, temperature: 0.2 }
  }));

  const messages: any[] = [{ role: 'user', parts: [{ text: message }] }];

  let maxLoops = 3;
  while (response.functionCalls && response.functionCalls.length > 0 && maxLoops > 0) {
    maxLoops--;
    messages.push(response.candidates![0].content);

    const functionResponses = [];
    for (const call of response.functionCalls) {
      let result;
      try {
        const fnName = call.name || '';
        result = queryFunctions[fnName] ? await queryFunctions[fnName](call.args) : { error: 'Unknown function' };
      } catch (e: any) {
        result = { error: e.message };
      }
      functionResponses.push({ functionResponse: { name: call.name, response: { result } } });
    }

    messages.push({ role: 'user', parts: functionResponses });

    response = await withRetry(() => ai.models.generateContent({
      model: MODEL,
      contents: messages as any,
      config: { systemInstruction, tools: queryTools, temperature: 0.2 }
    }));
  }

  return response.text || 'I could not find an answer. Please try rephrasing your question.';
}

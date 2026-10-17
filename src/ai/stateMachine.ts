/**
 * stateMachine.ts — Deterministic State Machine for Invoicing Workflows
 * 
 * All handlers take plain (ctx, message) and return StateResult.
 * Every handler is DEFENSIVE — checks for undefined/null before accessing nested props.
 * The LLM is NOT called here (except for entity extraction).
 */

import Customer from '../models/Customer';
import Supplier from '../models/Supplier';
import Item from '../models/Item';
import Invoice from '../models/Invoice';
import { extractEntities } from './llm';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StateResult {
  response: string;
  nextState: string;
  contextData: any;
}

// ─── Required Fields ────────────────────────────────────────────────────────

const REQUIRED_PARTY_FIELDS = ['name', 'phone'] as const;
const REQUIRED_ITEM_FIELDS = ['name', 'purchasePrice', 'sellingPrice', 'primaryUnit'] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getMissingFields(draft: any, requiredFields: readonly string[]): string[] {
  if (!draft) return [...requiredFields];
  return requiredFields.filter(f => draft[f] === undefined || draft[f] === null || draft[f] === '');
}

function formatMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    name: 'Name',
    phone: 'Phone Number',
    purchasePrice: 'Purchase Price',
    sellingPrice: 'Selling Price',
    primaryUnit: 'Unit (e.g., packet, kg, piece, box)',
  };
  return fields.map(f => `• **${labels[f] || f}**`).join('\n');
}

async function generateInvoiceNumber(type: string): Promise<string> {
  const prefix = type === 'sale' ? 'INV-SL-' : 'INV-PR-';
  const latest = await Invoice.findOne({ type: type as 'sale' | 'purchase' }).sort({ createdAt: -1 });
  let next = 1;
  if (latest?.invoiceNumber) {
    const parts = latest.invoiceNumber.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${next.toString().padStart(3, '0')}`;
}

// ─── VERIFY PARTY ───────────────────────────────────────────────────────────

async function handleVerifyParty(ctx: any, _message: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;
  const Model = type === 'sale' ? Customer : Supplier;
  const partyLabel = type === 'sale' ? 'Customer' : 'Supplier';

  if (!ctx.draft?.partyName) {
    return {
      response: `Who is the **${partyLabel.toLowerCase()}**?`,
      nextState: `${type}:verify_party`,
      contextData: ctx,
    };
  }

  const party = await Model.findOne({ name: new RegExp('^' + ctx.draft.partyName + '$', 'i') });

  if (party) {
    ctx.partyId = party._id;
    ctx.partyNameResolved = party.name;
    return handleVerifyItems(ctx, _message);
  }

  // Party not found
  ctx.partyDraft = { name: ctx.draft.partyName };
  return {
    response: `${partyLabel} **"${ctx.draft.partyName}"** was not found in the system.\n\nWould you like to add them? I'll need their:\n${formatMissingFields(['phone'])}`,
    nextState: `${type}:create_party`,
    contextData: ctx,
  };
}

// ─── CREATE PARTY ───────────────────────────────────────────────────────────

async function handleCreateParty(ctx: any, message: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;
  const partyLabel = type === 'sale' ? 'Customer' : 'Supplier';
  const Model = type === 'sale' ? Customer : Supplier;

  // Safety: ensure partyDraft exists
  if (!ctx.partyDraft) {
    ctx.partyDraft = { name: ctx.draft?.partyName || 'Unknown' };
  }

  // Extract entities from user's message
  const extracted = await extractEntities(message, `User is providing details for a new ${partyLabel.toLowerCase()} named "${ctx.partyDraft.name}"`);

  // Merge extracted data
  if (extracted.phone) ctx.partyDraft.phone = extracted.phone;
  if (extracted.email) ctx.partyDraft.email = extracted.email;

  // Fallback: try to find any number in the message as phone
  if (!ctx.partyDraft.phone) {
    const phoneMatch = message.match(/\b(\d{2,})\b/);
    if (phoneMatch) ctx.partyDraft.phone = phoneMatch[1];
  }

  // Validate
  const missing = getMissingFields(ctx.partyDraft, REQUIRED_PARTY_FIELDS);
  if (missing.length > 0) {
    return {
      response: `I still need the following to create ${partyLabel} **"${ctx.partyDraft.name}"**:\n${formatMissingFields(missing)}`,
      nextState: `${type}:create_party`,
      contextData: ctx,
    };
  }

  // Create
  try {
    const party = new Model({
      name: ctx.partyDraft.name,
      phone: ctx.partyDraft.phone,
      email: ctx.partyDraft.email || undefined,
      outstandingBalance: 0,
    });
    await party.save();
    ctx.partyId = party._id;
    ctx.partyNameResolved = party.name;
    ctx.partyDraft = null; // cleanup

    return handleVerifyItems(ctx, message);
  } catch (e: any) {
    return {
      response: `❌ Failed to create ${partyLabel}: ${e.message}. Please try again.`,
      nextState: `${type}:create_party`,
      contextData: ctx,
    };
  }
}

// ─── VERIFY ITEMS ───────────────────────────────────────────────────────────

async function handleVerifyItems(ctx: any, message: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;

  if (!ctx.verifiedItems) ctx.verifiedItems = [];
  if (!ctx.draft?.items?.length) {
    return {
      response: 'What **items** are in this invoice? Please provide item names and quantities.',
      nextState: `${type}:verify_items`,
      contextData: ctx,
    };
  }

  for (let i = 0; i < ctx.draft.items.length; i++) {
    const draftItem = ctx.draft.items[i];
    if (!draftItem?.name) continue;

    // Skip already verified
    if (ctx.verifiedItems.find((v: any) => v.name.toLowerCase() === draftItem.name.toLowerCase())) continue;

    const itemDoc = await Item.findOne({ name: new RegExp('^' + draftItem.name + '$', 'i') });
    if (!itemDoc) {
      ctx.itemDraft = { name: draftItem.name };
      ctx.currentItemIndex = i;

      return {
        response: `📦 Item **"${draftItem.name}"** is not in your inventory.\n\nWould you like to add it? I'll need:\n${formatMissingFields(['purchasePrice', 'sellingPrice', 'primaryUnit'])}`,
        nextState: `${type}:create_item`,
        contextData: ctx,
      };
    }

    ctx.verifiedItems.push({
      itemId: itemDoc._id,
      name: itemDoc.name,
      quantity: draftItem.quantity || 1,
      price: draftItem.price || (type === 'sale' ? itemDoc.sellingPrice : itemDoc.purchasePrice),
      sellingPrice: itemDoc.sellingPrice,
      purchasePrice: itemDoc.purchasePrice,
      stock: itemDoc.stockQuantity,
    });
  }

  // All verified → next step
  if (type === 'sale') {
    return handleVerifyStock(ctx, message);
  }
  return handleConfirm(ctx, message);
}

// ─── CREATE ITEM ────────────────────────────────────────────────────────────

async function handleCreateItem(ctx: any, message: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;

  // Safety: ensure itemDraft exists
  if (!ctx.itemDraft) {
    const idx = ctx.currentItemIndex ?? 0;
    const draftItem = ctx.draft?.items?.[idx];
    ctx.itemDraft = { name: draftItem?.name || 'Unknown' };
  }

  // Extract entities
  const extracted = await extractEntities(message, `User is providing details for a new inventory item named "${ctx.itemDraft.name}". They need to provide purchase price, selling price, and unit.`);

  // Merge
  if (extracted.purchasePrice !== undefined) ctx.itemDraft.purchasePrice = extracted.purchasePrice;
  if (extracted.sellingPrice !== undefined) ctx.itemDraft.sellingPrice = extracted.sellingPrice;
  if (extracted.primaryUnit) ctx.itemDraft.primaryUnit = extracted.primaryUnit;
  if (extracted.stockQuantity !== undefined) ctx.itemDraft.stockQuantity = extracted.stockQuantity;

  // Validate
  const missing = getMissingFields(ctx.itemDraft, REQUIRED_ITEM_FIELDS);
  if (missing.length > 0) {
    return {
      response: `I still need the following to add **"${ctx.itemDraft.name}"** to inventory:\n${formatMissingFields(missing)}`,
      nextState: `${type}:create_item`,
      contextData: ctx,
    };
  }

  // Create
  try {
    const item = new Item({
      name: ctx.itemDraft.name,
      purchasePrice: ctx.itemDraft.purchasePrice,
      sellingPrice: ctx.itemDraft.sellingPrice,
      primaryUnit: ctx.itemDraft.primaryUnit,
      stockQuantity: ctx.itemDraft.stockQuantity || 0,
    });
    await item.save();

    const idx = ctx.currentItemIndex ?? 0;
    const draftItem = ctx.draft?.items?.[idx];
    ctx.verifiedItems.push({
      itemId: item._id,
      name: item.name,
      quantity: draftItem?.quantity || 1,
      price: draftItem?.price || (type === 'sale' ? item.sellingPrice : item.purchasePrice),
      sellingPrice: item.sellingPrice,
      purchasePrice: item.purchasePrice,
      stock: item.stockQuantity,
    });

    ctx.itemDraft = null;
    ctx.currentItemIndex = null;

    // Continue verifying remaining items
    return handleVerifyItems(ctx, message);
  } catch (e: any) {
    return {
      response: `❌ Failed to create item: ${e.message}. Please try again.`,
      nextState: `${type}:create_item`,
      contextData: ctx,
    };
  }
}

// ─── VERIFY STOCK ───────────────────────────────────────────────────────────

async function handleVerifyStock(ctx: any, message: string): Promise<StateResult> {
  const shortages: { name: string; requested: number; available: number }[] = [];
  for (const item of (ctx.verifiedItems || [])) {
    if (item.stock < item.quantity) {
      shortages.push({ name: item.name, requested: item.quantity, available: item.stock });
    }
  }

  if (shortages.length > 0) {
    const table = shortages.map(s => `| ${s.name} | ${s.requested} | ${s.available} | ${s.requested - s.available} |`).join('\n');
    ctx.shortages = shortages;

    return {
      response: `⚠️ **Insufficient Stock!** You cannot complete this sale.\n\n| Item | Requested | Available | Shortage |\n|---|---|---|---|\n${table}\n\nWould you like me to create a **Purchase Invoice** first to restock these items?`,
      nextState: 'sale:insufficient_stock',
      contextData: ctx,
    };
  }

  return handleConfirm(ctx, message);
}

// ─── CONFIRM ────────────────────────────────────────────────────────────────

async function handleConfirm(ctx: any, _message: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;
  const typeLabel = type === 'sale' ? 'Sale' : 'Purchase';

  const itemsTable = (ctx.verifiedItems || []).map((item: any) => {
    const total = item.price * item.quantity;
    return `| ${item.name} | ${item.quantity} | ₹${item.price} | ₹${total} |`;
  }).join('\n');

  const grandTotal = (ctx.verifiedItems || []).reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
  const amountPaid = ctx.draft?.amountPaid || 0;
  const balance = grandTotal - amountPaid;

  return {
    response: `### ${typeLabel} Invoice Summary\n\n**${type === 'sale' ? 'Customer' : 'Supplier'}:** ${ctx.partyNameResolved}\n\n| Item | Qty | Unit Price | Total |\n|---|---|---|---|\n${itemsTable}\n\n**Grand Total:** ₹${grandTotal}\n**Amount Paid:** ₹${amountPaid}\n**Balance Due:** ₹${balance}\n\n✅ Shall I create this invoice?`,
    nextState: `${type}:confirm`,
    contextData: ctx,
  };
}

// ─── EXECUTE ────────────────────────────────────────────────────────────────

async function handleExecute(ctx: any, _message: string, userId: string): Promise<StateResult> {
  const type: 'sale' | 'purchase' = ctx.type;
  const typeLabel = type === 'sale' ? 'Sale' : 'Purchase';

  try {
    const processedItems = [];
    let subTotal = 0;
    let totalProfit = 0;

    for (const item of (ctx.verifiedItems || [])) {
      const lineTotal = item.price * item.quantity;
      subTotal += lineTotal;

      if (type === 'sale') {
        totalProfit += (item.price - item.purchasePrice) * item.quantity;
      }

      processedItems.push({
        item: item.itemId,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        taxRate: 0,
        discount: 0,
        total: lineTotal,
      });

      // Update stock
      const itemDoc = await Item.findById(item.itemId);
      if (itemDoc) {
        if (type === 'sale') itemDoc.stockQuantity -= item.quantity;
        else itemDoc.stockQuantity += item.quantity;
        await itemDoc.save();
      }
    }

    const grandTotal = subTotal;
    const paid = ctx.draft?.amountPaid || 0;
    const pendingAmount = grandTotal - paid;
    const status = paid >= grandTotal ? 'paid' : (paid > 0 ? 'partial' : 'pending');

    if (pendingAmount > 0) {
      const PartyModel = type === 'sale' ? Customer : Supplier;
      await PartyModel.findByIdAndUpdate(ctx.partyId, { $inc: { outstandingBalance: pendingAmount } });
    }

    const invoiceNumber = await generateInvoiceNumber(type);

    const invoice = new Invoice({
      type,
      invoiceNumber,
      date: new Date(),
      party: ctx.partyId,
      partyModel: type === 'sale' ? 'Customer' : 'Supplier',
      partyName: ctx.partyNameResolved,
      items: processedItems,
      subTotal,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal,
      profit: type === 'sale' ? totalProfit : 0,
      status,
      amountPaid: paid,
      createdBy: userId,
    });

    await invoice.save();

    let successMsg = `✅ **${typeLabel} Invoice Created Successfully!**\n\n📄 **Invoice #:** ${invoiceNumber}\n👤 **${type === 'sale' ? 'Customer' : 'Supplier'}:** ${ctx.partyNameResolved}\n💰 **Total:** ₹${grandTotal}\n💵 **Paid:** ₹${paid}\n📊 **Status:** ${status.toUpperCase()}`;

    // ── RESUME PENDING SALE after purchase restocking ────────────────
    if (type === 'purchase' && ctx.pendingSale) {
      const saleDraft = ctx.pendingSale;
      
      // Re-verify stock levels with fresh data
      saleDraft.verifiedItems = [];
      
      successMsg += `\n\n---\n🔄 **Restocking complete!** Now resuming your original sale...\nLet me re-verify stock levels.`;

      // Return to sale verify_items state with the original sale context
      return {
        response: successMsg,
        nextState: 'sale:verify_items',
        contextData: saleDraft,
      };
    }

    return {
      response: successMsg,
      nextState: 'idle',
      contextData: {},
    };
  } catch (e: any) {
    return {
      response: `❌ Failed to create invoice: ${e.message}`,
      nextState: 'idle',
      contextData: {},
    };
  }
}

// ─── State Router ───────────────────────────────────────────────────────────

export async function runStateMachine(state: string, ctx: any, message: string, userId: string): Promise<StateResult> {
  console.log(`[StateMachine] Running state: ${state}`);
  
  switch (state) {
    case 'sale:verify_party':
    case 'purchase:verify_party':
      return handleVerifyParty(ctx, message);

    case 'sale:create_party':
    case 'purchase:create_party':
      return handleCreateParty(ctx, message);

    case 'sale:verify_items':
    case 'purchase:verify_items':
      return handleVerifyItems(ctx, message);

    case 'sale:create_item':
    case 'purchase:create_item':
      return handleCreateItem(ctx, message);

    case 'sale:verify_stock':
      return handleVerifyStock(ctx, message);

    case 'sale:confirm':
    case 'purchase:confirm':
      return handleExecute(ctx, message, userId);

    default:
      return {
        response: 'Something went wrong. Let me reset. How can I help you?',
        nextState: 'idle',
        contextData: {},
      };
  }
}

// ─── Pivot Helper ───────────────────────────────────────────────────────────

export function pivotToPurchase(ctx: any): { nextState: string; contextData: any } {
  const shortages = ctx.shortages || [];
  const purchaseItems = shortages.map((s: any) => ({
    name: s.name,
    quantity: s.requested - s.available,
  }));

  return {
    nextState: 'purchase:verify_party',
    contextData: {
      type: 'purchase',
      draft: {
        partyName: '',
        items: purchaseItems,
        amountPaid: 0,
      },
      verifiedItems: [],
      pendingSale: ctx,
    },
  };
}

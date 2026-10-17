import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Item from '../models/Item';
import Customer from '../models/Customer';
import Supplier from '../models/Supplier';
import Invoice from '../models/Invoice';
import Payment from '../models/Payment';
import { GraphQLError } from 'graphql';
import { processMessage } from '../ai/orchestrator';

export const resolvers = {
  Query: {
    me: async (_: any, __: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return User.findById(context.user.id);
    },
    items: async (_: any, __: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Item.find();
    },
    item: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Item.findById(id);
    },
    customers: async (_: any, __: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Customer.find();
    },
    customer: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Customer.findById(id);
    },
    suppliers: async (_: any, __: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Supplier.find();
    },
    supplier: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Supplier.findById(id);
    },
    invoices: async (_: any, { type }: { type?: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      const filter = type ? { type: type as 'sale' | 'purchase' } : {};
      return Invoice.find(filter).sort({ createdAt: -1 });
    },
    invoice: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return Invoice.findById(id);
    },
    nextInvoiceNumber: async (_: any, { type }: { type: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      
      const prefix = type === 'sale' ? 'INV-SL-' : 'INV-PR-';
      
      const latestInvoice = await Invoice.findOne({ type: type as 'sale' | 'purchase' }).sort({ createdAt: -1 });
      
      let nextNumber = 1;
      if (latestInvoice && latestInvoice.invoiceNumber) {
        const parts = latestInvoice.invoiceNumber.split('-');
        const lastPart = parts[parts.length - 1];
        const parsed = parseInt(lastPart, 10);
        if (!isNaN(parsed)) {
          nextNumber = parsed + 1;
        }
      }
      
      return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
    },
    dashboardStats: async (_: any, __: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const thirtyDaysAgo = new Date(startOfDay);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

      // Today Sales
      const todaySalesInvoices = await Invoice.find({ type: 'sale', date: { $gte: startOfDay } });
      const todaySales = todaySalesInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);

      // Monthly Profit
      const monthlySalesInvoices = await Invoice.find({ type: 'sale', date: { $gte: startOfMonth } });
      const monthlyProfit = monthlySalesInvoices.reduce((sum, inv) => sum + (inv.profit || 0), 0);

      // Receivables and Payables
      const customers = await Customer.find();
      const pendingReceivables = customers.reduce((sum, c) => sum + c.outstandingBalance, 0);

      const suppliers = await Supplier.find();
      const pendingPayables = suppliers.reduce((sum, s) => sum + s.outstandingBalance, 0);

      // Low Stock
      // We need to count items where stockQuantity <= lowStockThreshold
      // In mongodb, we can use $expr to compare two fields
      const lowStockItems = await Item.countDocuments({
        $expr: { $lte: ['$stockQuantity', '$lowStockThreshold'] }
      });

      // Sales Trend (Last 30 days)
      const invoicesLast30Days = await Invoice.find({ date: { $gte: thirtyDaysAgo } });
      
      const trendMap: { [key: string]: { sales: number; purchases: number } } = {};
      
      // Initialize all 30 days with 0
      for (let i = 0; i < 30; i++) {
        const d = new Date(thirtyDaysAgo);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        trendMap[dateStr] = { sales: 0, purchases: 0 };
      }

      invoicesLast30Days.forEach(inv => {
        const dateStr = inv.date.toISOString().split('T')[0];
        if (trendMap[dateStr]) {
          if (inv.type === 'sale') trendMap[dateStr].sales += inv.grandTotal;
          else if (inv.type === 'purchase') trendMap[dateStr].purchases += inv.grandTotal;
        }
      });

      const salesTrend = Object.keys(trendMap).sort().map(date => ({
        date,
        sales: trendMap[date].sales,
        purchases: trendMap[date].purchases
      }));

      return {
        todaySales,
        monthlyProfit,
        pendingReceivables,
        pendingPayables,
        lowStockItems,
        salesTrend
      };
    }
  },
  Mutation: {
    register: async (_: any, { name, email, password, role }: any) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) throw new GraphQLError('User already exists');

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const user = new User({ name, email, passwordHash, role: role || 'owner' });
      await user.save();

      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '1d' }
      );

      return { token, user };
    },
    login: async (_: any, { email, password }: any) => {
      const user = await User.findOne({ email });
      if (!user) throw new GraphQLError('Invalid credentials');

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) throw new GraphQLError('Invalid credentials');

      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '1d' }
      );

      return { token, user };
    },
    createItem: async (_: any, args: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      
      const item = new Item(args);
      await item.save();
      return item;
    },
    createCustomer: async (_: any, args: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      
      const customer = new Customer(args);
      await customer.save();
      return customer;
    },
    createSupplier: async (_: any, args: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      
      const supplier = new Supplier(args);
      await supplier.save();
      return supplier;
    },
    createInvoice: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      
      const { type, invoiceNumber, date, partyId, partyName, items, status, amountPaid } = input;
      const partyModel = type === 'sale' ? 'Customer' : 'Supplier';

      let subTotal = 0;
      let taxTotal = 0;
      let discountTotal = 0;
      let totalProfit = 0;

      const processedItems = [];

      // Process each item: calculate totals and update stock
      for (const itemInput of items) {
        const itemDoc = await Item.findById(itemInput.itemId);
        if (!itemDoc) throw new GraphQLError(`Item not found: ${itemInput.itemId}`);

        const quantity = itemInput.quantity;
        const price = itemInput.price;
        const taxRate = itemInput.taxRate || 0;
        const discount = itemInput.discount || 0;

        if (quantity <= 0) throw new GraphQLError(`Quantity must be greater than zero for item: ${itemDoc.name}`);
        if (price < 0) throw new GraphQLError(`Price cannot be negative for item: ${itemDoc.name}`);
        if (discount < 0) throw new GraphQLError(`Discount cannot be negative for item: ${itemDoc.name}`);

        // Prevent overselling
        if (type === 'sale' && itemDoc.stockQuantity < quantity) {
          throw new GraphQLError(`Insufficient stock for item ${itemDoc.name}. Available: ${itemDoc.stockQuantity}, Requested: ${quantity}`);
        }

        const lineTotal = (price * quantity) - discount + (price * quantity * taxRate / 100);

        subTotal += (price * quantity);
        taxTotal += (price * quantity * taxRate / 100);
        discountTotal += discount;

        if (type === 'sale') {
          totalProfit += ((price - itemDoc.purchasePrice) * quantity) - discount;
        }

        processedItems.push({
          item: itemInput.itemId,
          name: itemInput.name,
          quantity,
          price,
          taxRate,
          discount,
          total: lineTotal
        });

        // Update Stock sequentially (No Transactions as requested)
        if (type === 'sale') {
          itemDoc.stockQuantity -= quantity;
        } else if (type === 'purchase') {
          itemDoc.stockQuantity += quantity;
        }
        await itemDoc.save();
      }

      const grandTotal = subTotal + taxTotal - discountTotal;
      const finalStatus = status || 'pending';
      const paid = amountPaid || 0;

      // Update Customer/Supplier balance sequentially
      const pendingAmount = grandTotal - paid;
      if (pendingAmount > 0) {
        if (type === 'sale') {
          await Customer.findByIdAndUpdate(partyId, { $inc: { outstandingBalance: pendingAmount } });
        } else if (type === 'purchase') {
          await Supplier.findByIdAndUpdate(partyId, { $inc: { outstandingBalance: pendingAmount } });
        }
      }

      const invoice = new Invoice({
        type,
        invoiceNumber,
        date: date || new Date(),
        party: partyId,
        partyModel,
        partyName,
        items: processedItems,
        subTotal,
        taxTotal,
        discountTotal,
        grandTotal,
        profit: type === 'sale' ? totalProfit : 0,
        status: finalStatus,
        amountPaid: paid,
        createdBy: context.user.id
      });

      await invoice.save();
      return invoice;
    },
    addPayment: async (_: any, { invoiceId, amount, method, notes }: any, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      if (amount <= 0) throw new GraphQLError('Payment amount must be greater than zero');

      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) throw new GraphQLError('Invoice not found');

      const payment = new Payment({
        invoice: invoiceId,
        amount,
        method,
        notes,
        createdBy: context.user.id
      });
      await payment.save();

      invoice.amountPaid += amount;
      invoice.status = invoice.amountPaid >= invoice.grandTotal ? 'paid' : 'partial';
      await invoice.save();

      // Decrease outstanding balance
      if (invoice.type === 'sale') {
        await Customer.findByIdAndUpdate(invoice.party, { $inc: { outstandingBalance: -amount } });
      } else if (invoice.type === 'purchase') {
        await Supplier.findByIdAndUpdate(invoice.party, { $inc: { outstandingBalance: -amount } });
      }
      return payment;
    },
    askMunshi: async (_: any, { message, sessionId }: { message: string; sessionId?: string }, context: any) => {
      if (!context.user) throw new GraphQLError('Not authenticated');
      return processMessage(message, context.user.id, sessionId);
    }
  },
  Invoice: {
    payments: async (parent: any) => {
      return Payment.find({ invoice: parent._id }).sort({ date: -1 });
    }
  },
  Customer: {
    invoices: async (parent: any) => {
      return Invoice.find({ party: parent._id, type: 'sale' }).sort({ date: -1 });
    }
  },
  Supplier: {
    invoices: async (parent: any) => {
      return Invoice.find({ party: parent._id, type: 'purchase' }).sort({ date: -1 });
    }
  }
};

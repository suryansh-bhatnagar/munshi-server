import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceItem {
  item: mongoose.Types.ObjectId;
  name: string;
  quantity: number;
  price: number; // Unit price
  taxRate?: number;
  discount?: number;
  total: number; // (price * quantity) - discount + tax
}

export interface IInvoice extends Document {
  type: 'sale' | 'purchase';
  invoiceNumber: string;
  date: Date;
  party: mongoose.Types.ObjectId; // Customer for sale, Supplier for purchase
  partyModel: 'Customer' | 'Supplier';
  partyName: string;
  items: IInvoiceItem[];
  subTotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  profit?: number;
  status: 'pending' | 'paid' | 'partial';
  amountPaid: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
  taxRate: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
});

const InvoiceSchema: Schema = new Schema(
  {
    type: { type: String, enum: ['sale', 'purchase'], required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    party: { type: Schema.Types.ObjectId, required: true, refPath: 'partyModel' },
    partyModel: { type: String, required: true, enum: ['Customer', 'Supplier'] },
    partyName: { type: String, required: true },
    items: [InvoiceItemSchema],
    subTotal: { type: Number, required: true },
    taxTotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },
    profit: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'partial'], default: 'pending' },
    amountPaid: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  invoice: mongoose.Types.ObjectId;
  amount: number;
  method: string;
  notes?: string;
  date: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true, default: 'cash' }, // e.g., cash, bank_transfer, upi, cheque
    notes: { type: String },
    date: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IPayment>('Payment', PaymentSchema);

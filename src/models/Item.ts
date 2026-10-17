import mongoose, { Schema, Document } from 'mongoose';

export interface IItem extends Document {
  name: string;
  category: string;
  sku: string;
  barcode?: string;
  purchasePrice: number;
  sellingPrice: number;
  stockQuantity: number; // Stored in primary units, or base unit
  primaryUnit: string; // e.g., 'Box'
  secondaryUnit?: string; // e.g., 'Piece'
  conversionRate?: number; // 1 primaryUnit = X secondaryUnits
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String },
    sku: { type: String },
    barcode: { type: String },
    purchasePrice: { type: Number, required: true },
    sellingPrice: { type: Number, required: true },
    stockQuantity: { type: Number, required: true, default: 0 },
    primaryUnit: { type: String, required: true, default: 'PCS' },
    secondaryUnit: { type: String },
    conversionRate: { type: Number },
    lowStockThreshold: { type: Number, default: 5 },
  },
  { timestamps: true }
);

export default mongoose.model<IItem>('Item', ItemSchema);

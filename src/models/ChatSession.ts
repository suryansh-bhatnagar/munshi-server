import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: any[]; // Simplified for storing tool call metadata
  timestamp: Date;
}

export interface IChatSession extends Document {
  user: mongoose.Types.ObjectId;
  state: string; // e.g., 'idle', 'creating_invoice', 'creating_purchase'
  contextData: any; // Stores Drafts (e.g., partial invoice data)
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  role: { type: String, enum: ['user', 'assistant', 'system', 'tool'], required: true },
  content: { type: String, required: true },
  toolCalls: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
});

const ChatSessionSchema: Schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    state: { type: String, default: 'idle' },
    contextData: { type: Schema.Types.Mixed, default: {} }, // Dynamic draft storage
    messages: [MessageSchema],
  },
  { timestamps: true }
);

export default mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);

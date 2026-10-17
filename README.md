# Munshi Server 💼🤖

Munshi Server is the backend engine for Munshi — an AI-powered conversational accounting & inventory management assistant for small businesses.

Built with **Node.js**, **Express**, **Apollo Server (GraphQL)**, **MongoDB (Mongoose)**, and **Google Gemini AI**.

---

## 🌟 Architecture Highlights

- **Deterministic Hybrid AI Orchestrator**:
  - **LLM (`llm.ts`)**: Natural language entity extraction and intent classification using Gemini 2.5 Flash with structured JSON schemas.
  - **State Machine (`stateMachine.ts`)**: Strict deterministic state machine enforcing double-entry validation, stock checks, customer/supplier verification, and invoice calculations. Code makes business decisions, not the AI.
  - **Session Management (`ChatSession.ts`)**: MongoDB-persisted multi-turn conversational memory with auto-recovery and auto-pivoting (e.g. pivoting smoothly between sales and purchase flows upon stockout).
- **GraphQL API (`typeDefs.ts` & `resolvers.ts`)**:
  - Full CRUD operations for Customers, Suppliers, Items, Invoices, Payments, and Users.
  - Real-time `askMunshi` mutation handling conversational queries and transactions.
- **Robust Error Handling**:
  - Transient error handling (API quota 429, overload 503, network drops) with graceful user feedback and preserved session states.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (running locally or MongoDB Atlas)
- Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### 1. Installation
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/munshi
JWT_SECRET=your_jwt_secret_key
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Run Development Server
```bash
npm run dev
```
The GraphQL server will be available at:
`http://localhost:5000/graphql`

---

## 📂 Project Structure

```
munshi-server/
├── src/
│   ├── ai/
│   │   ├── llm.ts            # Gemini prompt engineering & JSON schema extraction
│   │   ├── stateMachine.ts   # Deterministic step-by-step transaction validation
│   │   └── orchestrator.ts   # Session manager, intent routing & error recovery
│   ├── graphql/
│   │   ├── typeDefs.ts       # GraphQL schemas
│   │   └── resolvers.ts      # Query & Mutation resolvers
│   ├── models/               # Mongoose data models
│   └── index.ts              # Express & Apollo Server setup
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

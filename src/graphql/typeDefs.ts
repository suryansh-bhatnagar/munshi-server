export const typeDefs = `#graphql
  type User {
    id: ID!
    name: String!
    email: String!
    role: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Item {
    id: ID!
    name: String!
    category: String
    sku: String
    barcode: String
    purchasePrice: Float!
    sellingPrice: Float!
    stockQuantity: Float!
    primaryUnit: String!
    secondaryUnit: String
    conversionRate: Float
    lowStockThreshold: Float!
    createdAt: String!
    updatedAt: String!
  }

  type Customer {
    id: ID!
    name: String!
    phone: String!
    email: String
    address: String
    gstNumber: String
    outstandingBalance: Float!
    invoices: [Invoice!]
    createdAt: String!
    updatedAt: String!
  }

  type Supplier {
    id: ID!
    name: String!
    phone: String!
    email: String
    address: String
    gstNumber: String
    outstandingBalance: Float!
    invoices: [Invoice!]
    createdAt: String!
    updatedAt: String!
  }

  type InvoiceItem {
    id: ID
    item: Item!
    name: String!
    quantity: Float!
    price: Float!
    taxRate: Float
    discount: Float
    total: Float!
  }

  type Payment {
    id: ID!
    invoice: ID!
    amount: Float!
    method: String!
    notes: String
    date: String!
    createdAt: String!
    updatedAt: String!
  }

  type Invoice {
    id: ID!
    type: String!
    invoiceNumber: String!
    date: String!
    party: ID!
    partyName: String!
    items: [InvoiceItem!]!
    subTotal: Float!
    taxTotal: Float!
    discountTotal: Float!
    grandTotal: Float!
    status: String!
    amountPaid: Float!
    payments: [Payment!]
    createdAt: String!
    updatedAt: String!
  }

  input InvoiceItemInput {
    itemId: ID!
    name: String!
    quantity: Float!
    price: Float!
    taxRate: Float
    discount: Float
  }

  input InvoiceInput {
    type: String!
    invoiceNumber: String!
    date: String
    partyId: ID!
    partyName: String!
    items: [InvoiceItemInput!]!
    status: String
    amountPaid: Float
  }

  type MunshiResponse {
    text: String!
    sessionId: String!
  }

  type SaleTrend {
    date: String!
    sales: Float!
    purchases: Float!
  }

  type DashboardStats {
    todaySales: Float!
    monthlyProfit: Float!
    pendingReceivables: Float!
    pendingPayables: Float!
    lowStockItems: Int!
    salesTrend: [SaleTrend!]!
  }

  type Query {
    me: User
    items: [Item!]!
    item(id: ID!): Item
    customers: [Customer!]!
    customer(id: ID!): Customer
    suppliers: [Supplier!]!
    supplier(id: ID!): Supplier
    invoices(type: String): [Invoice!]!
    invoice(id: ID!): Invoice
    nextInvoiceNumber(type: String!): String!
    dashboardStats: DashboardStats!
  }

  type Mutation {
    register(name: String!, email: String!, password: String!, role: String): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    
    createItem(
      name: String!
      category: String
      sku: String
      barcode: String
      purchasePrice: Float!
      sellingPrice: Float!
      stockQuantity: Float
      primaryUnit: String!
      secondaryUnit: String
      conversionRate: Float
      lowStockThreshold: Float
    ): Item!

    createCustomer(
      name: String!
      phone: String!
      email: String
      address: String
      gstNumber: String
      outstandingBalance: Float
    ): Customer!

    createSupplier(
      name: String!
      phone: String!
      email: String
      address: String
      gstNumber: String
      outstandingBalance: Float
    ): Supplier!

    createInvoice(input: InvoiceInput!): Invoice!
    
    addPayment(invoiceId: ID!, amount: Float!, method: String!, notes: String): Payment!
    askMunshi(message: String!, sessionId: String): MunshiResponse!
  }
`;

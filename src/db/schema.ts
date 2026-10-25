import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Charlotte Esthy POS — relational schema.
 *
 * Multi-business isolation: every business-owned table carries `business_id`
 * and every server query is scoped by the business of the authenticated
 * session (see src/lib/auth.ts and src/lib/api.ts).
 * Money is stored as numeric(12,2); calculations happen in integer cents.
 */

export const roleEnum = pgEnum("member_role", ["owner", "manager", "cashier"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "disabled"]);
export const saleStatusEnum = pgEnum("sale_status", [
  "completed",
  "partially_refunded",
  "refunded",
  "voided",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "transfer", "card"]);
export const discountTypeEnum = pgEnum("discount_type", ["none", "percent", "fixed"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "initial",
  "restock",
  "adjustment",
  "damage",
  "sale",
  "refund",
]);
export const refundKindEnum = pgEnum("refund_kind", ["refund", "void"]);

const money = (name: string) => numeric(name, { precision: 12, scale: 2 }).notNull().default("0");
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ───────────────────────── Identity ─────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  /** Null until the address is verified. Set at creation when no mail provider is configured (see README). */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** One-time email verification links. Only the SHA-256 hash of the token is stored. */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_verifications_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
 );

/** Single-use short-lived ticket for carrying sign-in from a cookie-blocking embedded frame to a top-level tab. */
export const authHandoffs = pgTable(
  "auth_handoffs",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_handoffs_user_expiry_idx").on(t.userId, t.expiresAt)],
);

// ───────────────────────── Business ─────────────────────────

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/** Receipt, currency, tax, numbering and inventory settings (one row per business). */
export const businessSettings = pgTable("business_settings", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  receiptBusinessName: text("receipt_business_name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  logoUrl: text("logo_url"),
  currency: text("currency").notNull().default("NGN"),
  locale: text("locale").notNull().default("en-NG"),
  timezone: text("timezone").notNull().default("Africa/Lagos"),
  taxName: text("tax_name").notNull().default("Tax"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxInclusive: boolean("tax_inclusive").notNull().default(false),
  receiptPrefix: text("receipt_prefix").notNull().default("CE-"),
  receiptPadding: integer("receipt_padding").notNull().default(6),
  nextReceiptNumber: bigint("next_receipt_number", { mode: "number" }).notNull().default(1),
  receiptFooter: text("receipt_footer").notNull().default("Thank you for your purchase!"),
  receiptWidth: text("receipt_width").notNull().default("80mm"),
  defaultLowStockThreshold: integer("default_low_stock_threshold").notNull().default(5),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_business_user_uq").on(t.businessId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

// ───────────────────────── Catalogue ─────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_business_name_uq").on(t.businessId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    description: text("description"),
    imageUrl: text("image_url"),
    price: money("price"),
    costPrice: money("cost_price"),
    stockQty: integer("stock_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_business_sku_uq").on(t.businessId, t.sku),
    uniqueIndex("products_business_barcode_uq").on(t.businessId, t.barcode),
    index("products_business_active_idx").on(t.businessId, t.isActive),
    check("products_price_nonneg", sql`${t.price} >= 0`),
    check("products_cost_nonneg", sql`${t.costPrice} >= 0`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_business_idx").on(t.businessId, t.name)],
);

// ───────────────────────── Sales ─────────────────────────

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    receiptNumber: text("receipt_number").notNull(),
    receiptSeq: bigint("receipt_seq", { mode: "number" }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),
    status: saleStatusEnum("status").notNull().default("completed"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal"),
    discountType: discountTypeEnum("discount_type").notNull().default("none"),
    discountValue: money("discount_value"),
    discountAmount: money("discount_amount"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    taxAmount: money("tax_amount"),
    total: money("total"),
    amountPaid: money("amount_paid"),
    changeDue: money("change_due"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    refundedAmount: money("refunded_amount"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_business_receipt_uq").on(t.businessId, t.receiptNumber),
    uniqueIndex("sales_business_idem_uq").on(t.businessId, t.idempotencyKey),
    index("sales_business_created_idx").on(t.businessId, t.createdAt),
    index("sales_business_cashier_idx").on(t.businessId, t.cashierId),
    index("sales_customer_idx").on(t.customerId),
    check("sales_total_nonneg", sql`${t.total} >= 0`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price"),
    unitCost: money("unit_cost"),
    lineTotal: money("line_total"),
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_business_product_idx").on(t.businessId, t.productId),
    check("sale_items_qty_positive", sql`${t.quantity} > 0`),
    check("sale_items_refunded_range", sql`${t.refundedQuantity} >= 0 and ${t.refundedQuantity} <= ${t.quantity}`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: paymentMethodEnum("method").notNull(),
    amount: money("amount"),
    tendered: money("tendered"),
    changeDue: money("change_due"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_sale_idx").on(t.saleId), index("payments_business_idx").on(t.businessId, t.createdAt)],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: movementTypeEnum("type").notNull(),
    quantityChange: integer("quantity_change").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason"),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("movements_business_created_idx").on(t.businessId, t.createdAt),
    index("movements_product_idx").on(t.productId, t.createdAt),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    kind: refundKindEnum("kind").notNull(),
    amount: money("amount"),
    reason: text("reason").notNull(),
    restocked: boolean("restocked").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_sale_idx").on(t.saleId), index("refunds_business_created_idx").on(t.businessId, t.createdAt)],
);

export const refundItems = pgTable(
  "refund_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refundId: uuid("refund_id")
      .notNull()
      .references(() => refunds.id, { onDelete: "cascade" }),
    saleItemId: uuid("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    amount: money("amount"),
  },
  (t) => [index("refund_items_refund_idx").on(t.refundId)],
);

// ───────────────────────── Expenses ─────────────────────────

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748b"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("expense_categories_business_name_uq").on(t.businessId, t.name),
    index("expense_categories_business_idx").on(t.businessId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    amount: money("amount"),
    date: text("date").notNull(), // ISO YYYY-MM-DD string
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("cash"),
    reference: text("reference"),
    note: text("note"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_business_date_idx").on(t.businessId, t.date),
    index("expenses_category_idx").on(t.categoryId),
    index("expenses_recorded_by_idx").on(t.recordedBy),
    check("expenses_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ───────────────────────── Audit ─────────────────────────

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_business_created_idx").on(t.businessId, t.createdAt)],
);

export type Settings = typeof businessSettings.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;

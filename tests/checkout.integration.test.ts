import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { businesses, businessSettings, inventoryMovements, memberships, payments, products, sales, users } from "@/db/schema";
import { createSale, getSaleDetail, refundSale } from "@/lib/services/sales";

/**
 * Integration tests against the real PostgreSQL database configured in DATABASE_URL.
 * They create two isolated businesses with a unique tag and remove them afterwards.
 */
const tag = `vt${Date.now()}`;
let A: { userId: string; cashierId: string; businessId: string; productId: string; product2Id: string };
let B: { userId: string; businessId: string; productId: string };

async function makeBusiness(name: string, settings: Partial<typeof businessSettings.$inferInsert> = {}) {
  const [owner] = await db.insert(users).values({ email: `${tag}-${name}-owner@test.local`, passwordHash: "x", fullName: `${name} Owner` }).returning();
  const [cashier] = await db.insert(users).values({ email: `${tag}-${name}-cashier@test.local`, passwordHash: "x", fullName: `${name} Cashier` }).returning();
  const [b] = await db.insert(businesses).values({ name: `${tag} ${name}` }).returning();
  await db.insert(businessSettings).values({ businessId: b.id, receiptBusinessName: name, receiptPrefix: "T-", receiptPadding: 6, ...settings });
  await db.insert(memberships).values([
    { businessId: b.id, userId: owner.id, role: "owner" },
    { businessId: b.id, userId: cashier.id, role: "cashier" },
  ]);
  return { owner, cashier, b };
}

async function makeProduct(businessId: string, name: string, price: string, stock: number, cost = "4.00") {
  const [p] = await db.insert(products).values({ businessId, name, price, costPrice: cost, stockQty: stock }).returning();
  return p.id;
}

const stockOf = async (id: string) => (await db.select({ s: products.stockQty }).from(products).where(eq(products.id, id)))[0].s;
const sale = (over: Partial<Parameters<typeof createSale>[0]> = {}) =>
  createSale({
    businessId: A.businessId,
    cashierId: A.cashierId,
    items: [{ productId: A.productId, quantity: 1 }],
    discountType: "none",
    discountValue: 0,
    paymentMethod: "card",
    idempotencyKey: `${tag}-${Math.random().toString(36).slice(2)}-padding`,
    ...over,
  });

beforeAll(async () => {
  const a = await makeBusiness("A", { taxRate: "10.00", currency: "USD" });
  const b = await makeBusiness("B");
  const productId = await makeProduct(a.b.id, "Widget", "10.00", 100);
  const product2Id = await makeProduct(a.b.id, "Gadget", "7.50", 100);
  const bProduct = await makeProduct(b.b.id, "Other Business Item", "1.00", 100);
  A = { userId: a.owner.id, cashierId: a.cashier.id, businessId: a.b.id, productId, product2Id };
  B = { userId: b.owner.id, businessId: b.b.id, productId: bProduct };
});

afterAll(async () => {
  await db.delete(businesses).where(like(businesses.name, `${tag}%`));
  await db.delete(users).where(like(users.email, `${tag}%`));
  await pool.end();
});

describe("checkout", () => {
  it("computes totals on the server, deducts stock and records the payment & movement", async () => {
    const before = await stockOf(A.productId);
    const r = await createSale({
      businessId: A.businessId,
      cashierId: A.cashierId,
      items: [{ productId: A.productId, quantity: 3 }, { productId: A.product2Id, quantity: 2 }],
      discountType: "percent",
      discountValue: 10,
      paymentMethod: "cash",
      amountTendered: 100,
      idempotencyKey: `${tag}-basic-totals-key`,
    });
    expect(r.receiptNumber).toMatch(/^T-\d{6}$/);
    const d = (await getSaleDetail(A.businessId, r.saleId))!;
    // subtotal 30 + 15 = 45.00; discount 10% = 4.50; taxable 40.50; tax 10% = 4.05; total 44.55
    expect(d.subtotal).toBe("45.00");
    expect(d.discountAmount).toBe("4.50");
    expect(d.taxAmount).toBe("4.05");
    expect(d.total).toBe("44.55");
    expect(d.amountPaid).toBe("100.00");
    expect(d.changeDue).toBe("55.45");
    expect(d.items).toHaveLength(2);
    expect(await stockOf(A.productId)).toBe(before - 3);
    const pay = await db.select().from(payments).where(eq(payments.saleId, r.saleId));
    expect(pay).toHaveLength(1);
    expect(pay[0].amount).toBe("44.55");
    const mv = await db.select().from(inventoryMovements).where(eq(inventoryMovements.saleId, r.saleId));
    expect(mv.map((m) => m.quantityChange).sort((x, y) => x - y)).toEqual([-3, -2]);
    expect(mv.every((m) => m.type === "sale")).toBe(true);
  });

  it("rejects cash payments below the total and leaves stock and numbering untouched", async () => {
    const before = await stockOf(A.productId);
    await expect(sale({ paymentMethod: "cash", amountTendered: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(sale({ paymentMethod: "cash", amountTendered: null })).rejects.toMatchObject({ status: 422 });
    expect(await stockOf(A.productId)).toBe(before);
  });

  it("rejects invalid discounts and empty carts", async () => {
    await expect(sale({ discountType: "percent", discountValue: 150 })).rejects.toMatchObject({ status: 422 });
    await expect(sale({ discountType: "fixed", discountValue: 9999 })).rejects.toMatchObject({ status: 422 });
    await expect(sale({ items: [] })).rejects.toMatchObject({ status: 422 });
  });

  it("issues sequential, unique receipt numbers", async () => {
    const a = await sale();
    const b = await sale();
    const na = Number(a.receiptNumber.slice(2));
    expect(Number(b.receiptNumber.slice(2))).toBe(na + 1);
  });

  it("is idempotent: the same request key never creates a second sale", async () => {
    const key = `${tag}-idempotent-key-0001`;
    const before = await stockOf(A.productId);
    const first = await sale({ idempotencyKey: key });
    const second = await sale({ idempotencyKey: key });
    expect(second.duplicate).toBe(true);
    expect(second.saleId).toBe(first.saleId);
    expect(await stockOf(A.productId)).toBe(before - 1);
    const rows = await db.select().from(sales).where(and(eq(sales.businessId, A.businessId), eq(sales.idempotencyKey, key)));
    expect(rows).toHaveLength(1);
  });

  it("handles simultaneous duplicate submissions of the same key", async () => {
    const key = `${tag}-concurrent-dup-key-1`;
    const before = await stockOf(A.productId);
    const results = await Promise.all(Array.from({ length: 6 }, () => sale({ idempotencyKey: key })));
    expect(new Set(results.map((r) => r.saleId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await stockOf(A.productId)).toBe(before - 1);
  });

  it("never oversells under concurrent checkouts", async () => {
    const scarce = await makeProduct(A.businessId, "Scarce", "3.00", 5);
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => sale({ items: [{ productId: scarce, quantity: 1 }], idempotencyKey: `${tag}-race-${i}-xxxxxxxxxx` })),
    );
    const ok = attempts.filter((r) => r.status === "fulfilled");
    const failed = attempts.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(7);
    for (const f of failed) expect((f as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await stockOf(scarce)).toBe(0);
    const numbers = (ok as PromiseFulfilledResult<{ receiptNumber: string }>[]).map((r) => r.value.receiptNumber);
    expect(new Set(numbers).size).toBe(5);
    const mv = await db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, scarce));
    expect(mv.filter((m) => m.type === "sale")).toHaveLength(5);
  });

  it("refuses to sell more than the available stock in a single sale", async () => {
    const p = await makeProduct(A.businessId, "Two Only", "2.00", 2);
    await expect(sale({ items: [{ productId: p, quantity: 3 }] })).rejects.toMatchObject({ status: 409 });
    expect(await stockOf(p)).toBe(2);
  });

  it("can sell into negative stock only when explicitly allowed", async () => {
    const x = await makeBusiness("Neg", { allowNegativeStock: true });
    const p = await makeProduct(x.b.id, "Backorder", "5.00", 0);
    const r = await createSale({ businessId: x.b.id, cashierId: x.cashier.id, items: [{ productId: p, quantity: 2 }], discountType: "none", discountValue: 0, paymentMethod: "transfer", idempotencyKey: `${tag}-neg-allowed-0001` });
    expect(r.duplicate).toBe(false);
    expect(await stockOf(p)).toBe(-2);
  });
});

describe("business data isolation", () => {
  it("cannot sell another business's product", async () => {
    await expect(sale({ items: [{ productId: B.productId, quantity: 1 }] })).rejects.toMatchObject({ status: 422 });
    expect(await stockOf(B.productId)).toBe(100);
  });

  it("cannot read or refund another business's sale", async () => {
    const r = await sale();
    expect(await getSaleDetail(B.businessId, r.saleId)).toBeNull();
    await expect(refundSale({ businessId: B.businessId, saleId: r.saleId, userId: B.userId, kind: "void", reason: "attack", restock: true })).rejects.toMatchObject({ status: 404 });
    expect((await getSaleDetail(A.businessId, r.saleId))!.status).toBe("completed");
  });

  it("scopes cashier views to their own sales", async () => {
    const r = await sale();
    expect(await getSaleDetail(A.businessId, r.saleId, { cashierId: A.userId })).toBeNull(); // someone else's sale
    expect(await getSaleDetail(A.businessId, r.saleId, { cashierId: A.cashierId })).not.toBeNull();
  });

  it("cannot attach another business's customer to a sale", async () => {
    const { customers } = await import("@/db/schema");
    const [c] = await db.insert(customers).values({ businessId: B.businessId, name: "Foreign" }).returning();
    await expect(sale({ customerId: c.id })).rejects.toMatchObject({ status: 422 });
  });
});

describe("refunds and reversals", () => {
  it("supports partial then final refunds with exact amounts, restocking and status changes", async () => {
    const p = await makeProduct(A.businessId, "Refundable", "10.00", 10);
    const before = await stockOf(p);
    const r = await sale({ items: [{ productId: p, quantity: 3 }], discountType: "fixed", discountValue: 3, paymentMethod: "card" });
    // subtotal 30, discount 3, taxable 27, tax 2.70, total 29.70
    const d = (await getSaleDetail(A.businessId, r.saleId))!;
    expect(d.total).toBe("29.70");
    const itemId = d.items[0].id;

    const r1 = await refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "refund", items: [{ saleItemId: itemId, quantity: 1 }], reason: "Customer returned one", restock: true });
    expect(r1.amount).toBe("9.90"); // 29.70 * 10/30
    expect(r1.status).toBe("partially_refunded");
    expect(await stockOf(p)).toBe(before - 3 + 1);

    await expect(refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "refund", items: [{ saleItemId: itemId, quantity: 3 }], reason: "too many", restock: true })).rejects.toMatchObject({ status: 422 });
    await expect(refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "void", reason: "not allowed after refund", restock: true })).rejects.toMatchObject({ status: 409 });

    const r2 = await refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "refund", items: [{ saleItemId: itemId, quantity: 2 }], reason: "Returned the rest", restock: false });
    expect(r2.amount).toBe("19.80"); // exact remainder
    expect(r2.status).toBe("refunded");
    expect(await stockOf(p)).toBe(before - 3 + 1); // second return was not restocked

    const after = (await getSaleDetail(A.businessId, r.saleId))!;
    expect(after.refundedAmount).toBe("29.70");
    expect(after.refunds).toHaveLength(2);
    await expect(refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "refund", items: [{ saleItemId: itemId, quantity: 1 }], reason: "again", restock: true })).rejects.toMatchObject({ status: 409 });
  });

  it("cancels a sale, restores stock, keeps the record and writes an audit event", async () => {
    const p = await makeProduct(A.businessId, "Voidable", "4.00", 8);
    const r = await sale({ items: [{ productId: p, quantity: 5 }] });
    expect(await stockOf(p)).toBe(3);
    const v = await refundSale({ businessId: A.businessId, saleId: r.saleId, userId: A.userId, kind: "void", reason: "Entered by mistake", restock: true });
    expect(v.status).toBe("voided");
    expect(await stockOf(p)).toBe(8);
    const d = (await getSaleDetail(A.businessId, r.saleId))!; // still exists
    expect(d.status).toBe("voided");
    expect(d.refunds[0].kind).toBe("void");
    const { auditEvents } = await import("@/db/schema");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.saleId), inArray(auditEvents.action, ["sale.created", "sale.voided"])));
    expect(ev.map((e) => e.action).sort()).toEqual(["sale.created", "sale.voided"]);
  });
});

describe("database constraints", () => {
  it("rejects negative prices and duplicate receipt numbers", async () => {
    await expect(db.insert(products).values({ businessId: A.businessId, name: "Bad", price: "-1.00" })).rejects.toBeTruthy();
    const r = await sale();
    const d = await db.select().from(sales).where(eq(sales.id, r.saleId));
    await expect(db.insert(sales).values({ ...d[0], id: undefined, idempotencyKey: `${tag}-dup-receipt-number` })).rejects.toBeTruthy();
  });

  it("rejects duplicate SKUs within a business but allows the same SKU in another", async () => {
    await db.insert(products).values({ businessId: A.businessId, name: "S1", sku: `${tag}-SKU`, price: "1.00" });
    await expect(db.insert(products).values({ businessId: A.businessId, name: "S2", sku: `${tag}-SKU`, price: "1.00" })).rejects.toBeTruthy();
    await expect(db.insert(products).values({ businessId: B.businessId, name: "S3", sku: `${tag}-SKU`, price: "1.00" })).resolves.toBeDefined();
  });
});

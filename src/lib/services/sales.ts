import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  businesses,
  businessSettings,
  customers,
  inventoryMovements,
  payments,
  products,
  refundItems,
  refunds,
  saleItems,
  sales,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { HttpError } from "@/lib/errors";
import { calculateTotals, fromCents, MoneyError, toCents, type DiscountType } from "@/lib/money";
import { formatReceiptNumber, type BusinessInfo, type SaleDetail } from "@/lib/receipt";

export interface CheckoutInput {
  businessId: string;
  cashierId: string;
  items: { productId: string; quantity: number }[];
  discountType: DiscountType;
  discountValue: number;
  paymentMethod: "cash" | "transfer" | "card";
  amountTendered?: number | null;
  customerId?: string | null;
  note?: string | null;
  idempotencyKey: string;
}

/**
 * Creates a sale atomically.
 *  - Locks the business settings row, which serialises receipt numbering and
 *    guarantees unique, gap-free sequence numbers per business.
 *  - Re-reads prices from the database (client totals are never trusted).
 *  - Deducts stock with a conditional UPDATE so stock can never be oversold.
 *  - Is idempotent per (business, idempotencyKey): duplicate submissions return
 *    the original sale instead of creating another one.
 */
export async function createSale(input: CheckoutInput) {
  const { businessId, cashierId } = input;
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.businessId, businessId))
      .for("update");
    if (!settings) throw new HttpError(404, "Business not found");

    const [dup] = await tx
      .select({ id: sales.id, receiptNumber: sales.receiptNumber })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), eq(sales.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (dup) return { saleId: dup.id, receiptNumber: dup.receiptNumber, duplicate: true };

    const qtyById = new Map<string, number>();
    for (const it of input.items) qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.quantity);
    if (qtyById.size === 0) throw new HttpError(422, "The cart is empty");
    const ids = [...qtyById.keys()].sort();

    const prods = await tx
      .select()
      .from(products)
      .where(and(eq(products.businessId, businessId), inArray(products.id, ids), eq(products.isActive, true)));
    if (prods.length !== ids.length) throw new HttpError(422, "One or more products are no longer available");
    const byId = new Map(prods.map((p) => [p.id, p]));

    if (input.customerId) {
      const [c] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)));
      if (!c) throw new HttpError(422, "Customer not found");
    }

    let totals;
    try {
      totals = calculateTotals({
        lines: ids.map((id) => ({ unitPriceCents: toCents(byId.get(id)!.price), quantity: qtyById.get(id)! })),
        discountType: input.discountType,
        discountValue: input.discountValue,
        taxRatePercent: Number(settings.taxRate),
        taxInclusive: settings.taxInclusive,
      });
    } catch (e) {
      if (e instanceof MoneyError) throw new HttpError(422, e.message);
      throw e;
    }
    if (totals.totalCents <= 0) throw new HttpError(422, "The sale total must be greater than zero");

    let tenderedCents = totals.totalCents;
    let changeCents = 0;
    if (input.paymentMethod === "cash") {
      if (input.amountTendered === null || input.amountTendered === undefined) {
        throw new HttpError(422, "Enter the cash amount received");
      }
      tenderedCents = toCents(input.amountTendered);
      if (tenderedCents < totals.totalCents) throw new HttpError(422, "Cash received is less than the total due");
      changeCents = tenderedCents - totals.totalCents;
    }

    // Atomic, conditional stock deduction (sorted ids → consistent lock order).
    const movementRows: (typeof inventoryMovements.$inferInsert)[] = [];
    for (const id of ids) {
      const qty = qtyById.get(id)!;
      const p = byId.get(id)!;
      const [updated] = await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} - ${qty}`, updatedAt: new Date() })
        .where(
          and(
            eq(products.id, id),
            eq(products.businessId, businessId),
            settings.allowNegativeStock ? undefined : gte(products.stockQty, qty),
          ),
        )
        .returning({ stockQty: products.stockQty });
      if (!updated) throw new HttpError(409, `Not enough stock for "${p.name}"`);
      movementRows.push({
        businessId,
        productId: id,
        type: "sale",
        quantityChange: -qty,
        balanceAfter: updated.stockQty,
        reason: "Sale",
        userId: cashierId,
      });
    }

    const seq = Number(settings.nextReceiptNumber);
    const receiptNumber = formatReceiptNumber(settings.receiptPrefix, settings.receiptPadding, seq);
    await tx
      .update(businessSettings)
      .set({ nextReceiptNumber: seq + 1, updatedAt: new Date() })
      .where(eq(businessSettings.businessId, businessId));

    const [sale] = await tx
      .insert(sales)
      .values({
        businessId,
        receiptNumber,
        receiptSeq: seq,
        customerId: input.customerId ?? null,
        cashierId,
        status: "completed",
        currency: settings.currency,
        subtotal: fromCents(totals.subtotalCents),
        discountType: input.discountType,
        discountValue: input.discountType === "none" ? "0.00" : Number(input.discountValue).toFixed(2),
        discountAmount: fromCents(totals.discountCents),
        taxRate: settings.taxRate,
        taxInclusive: settings.taxInclusive,
        taxAmount: fromCents(totals.taxCents),
        total: fromCents(totals.totalCents),
        amountPaid: fromCents(tenderedCents),
        changeDue: fromCents(changeCents),
        paymentMethod: input.paymentMethod,
        note: input.note?.trim() || null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: sales.id });

    await tx.insert(saleItems).values(
      ids.map((id) => {
        const p = byId.get(id)!;
        const qty = qtyById.get(id)!;
        return {
          saleId: sale.id,
          businessId,
          productId: id,
          name: p.name,
          sku: p.sku,
          quantity: qty,
          unitPrice: p.price,
          unitCost: p.costPrice,
          lineTotal: fromCents(toCents(p.price) * qty),
        };
      }),
    );
    await tx.insert(payments).values({
      businessId,
      saleId: sale.id,
      method: input.paymentMethod,
      amount: fromCents(totals.totalCents),
      tendered: fromCents(tenderedCents),
      changeDue: fromCents(changeCents),
    });
    await tx.insert(inventoryMovements).values(movementRows.map((m) => ({ ...m, saleId: sale.id })));
    await audit(tx, {
      businessId,
      userId: cashierId,
      action: "sale.created",
      entityType: "sale",
      entityId: sale.id,
      metadata: { receiptNumber, total: fromCents(totals.totalCents), method: input.paymentMethod },
    });

    return { saleId: sale.id, receiptNumber, duplicate: false };
  });
}

export interface RefundInput {
  businessId: string;
  saleId: string;
  userId: string;
  kind: "refund" | "void";
  items?: { saleItemId: string; quantity: number }[];
  reason: string;
  restock: boolean;
}

/**
 * Refunds (full/partial) or cancels a sale. Completed sales are never deleted:
 * a refund record, optional stock return, and an audit event are written
 * atomically while the sale row is locked.
 */
export async function refundSale(input: RefundInput) {
  const { businessId, saleId, userId, kind } = input;
  return db.transaction(async (tx) => {
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
      .for("update");
    if (!sale) throw new HttpError(404, "Sale not found");
    if (sale.status === "refunded" || sale.status === "voided") {
      throw new HttpError(409, "This sale has already been fully reversed");
    }
    if (kind === "void" && sale.status !== "completed") {
      throw new HttpError(409, "Only sales without refunds can be cancelled. Use a refund instead.");
    }

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const byId = new Map(items.map((i) => [i.id, i]));

    const merged = new Map<string, number>();
    if (kind === "void") {
      for (const i of items) if (i.quantity - i.refundedQuantity > 0) merged.set(i.id, i.quantity - i.refundedQuantity);
    } else {
      for (const r of input.items ?? []) {
        if (r.quantity > 0) merged.set(r.saleItemId, (merged.get(r.saleItemId) ?? 0) + r.quantity);
      }
    }
    if (merged.size === 0) throw new HttpError(422, "Select at least one item to refund");

    let lineSum = 0;
    let requestedQty = 0;
    const lineValues = new Map<string, number>();
    for (const [itemId, qty] of merged) {
      const it = byId.get(itemId);
      if (!it) throw new HttpError(422, "Invalid sale item");
      if (qty > it.quantity - it.refundedQuantity) {
        throw new HttpError(422, `Cannot refund more than the remaining quantity of "${it.name}"`);
      }
      const v = toCents(it.unitPrice) * qty;
      lineValues.set(itemId, v);
      lineSum += v;
      requestedQty += qty;
    }

    const remainingQtyAfter = items.reduce((s, i) => s + (i.quantity - i.refundedQuantity), 0) - requestedQty;
    const totalCents = toCents(sale.total);
    const subtotalCents = toCents(sale.subtotal);
    const remainingCents = totalCents - toCents(sale.refundedAmount);
    const amountCents =
      remainingQtyAfter === 0
        ? remainingCents
        : Math.min(remainingCents, subtotalCents > 0 ? Math.round((totalCents * lineSum) / subtotalCents) : 0);

    const [refund] = await tx
      .insert(refunds)
      .values({
        businessId,
        saleId,
        kind,
        amount: fromCents(amountCents),
        reason: input.reason.trim(),
        restocked: input.restock,
        createdBy: userId,
      })
      .returning({ id: refunds.id });

    let allocated = 0;
    const entries = [...merged.entries()];
    for (let idx = 0; idx < entries.length; idx++) {
      const [itemId, qty] = entries[idx];
      const it = byId.get(itemId)!;
      const share =
        idx === entries.length - 1
          ? amountCents - allocated
          : lineSum > 0
            ? Math.round((amountCents * lineValues.get(itemId)!) / lineSum)
            : 0;
      allocated += share;
      await tx.insert(refundItems).values({ refundId: refund.id, saleItemId: itemId, quantity: qty, amount: fromCents(share) });
      await tx
        .update(saleItems)
        .set({ refundedQuantity: sql`${saleItems.refundedQuantity} + ${qty}` })
        .where(eq(saleItems.id, itemId));
      if (input.restock && it.productId) {
        const [p] = await tx
          .update(products)
          .set({ stockQty: sql`${products.stockQty} + ${qty}`, updatedAt: new Date() })
          .where(and(eq(products.id, it.productId), eq(products.businessId, businessId)))
          .returning({ stockQty: products.stockQty });
        if (p) {
          await tx.insert(inventoryMovements).values({
            businessId,
            productId: it.productId,
            type: "refund",
            quantityChange: qty,
            balanceAfter: p.stockQty,
            reason: `${kind === "void" ? "Cancelled" : "Refunded"} sale ${sale.receiptNumber}`,
            saleId,
            userId,
          });
        }
      }
    }

    const status = remainingQtyAfter === 0 ? (kind === "void" ? "voided" : "refunded") : "partially_refunded";
    await tx
      .update(sales)
      .set({ status, refundedAmount: fromCents(toCents(sale.refundedAmount) + amountCents) })
      .where(eq(sales.id, saleId));

    await audit(tx, {
      businessId,
      userId,
      action: kind === "void" ? "sale.voided" : "sale.refunded",
      entityType: "sale",
      entityId: saleId,
      metadata: { receiptNumber: sale.receiptNumber, amount: fromCents(amountCents), reason: input.reason, restocked: input.restock },
    });
    return { refundId: refund.id, amount: fromCents(amountCents), status };
  });
}

export async function getBusinessInfo(businessId: string): Promise<BusinessInfo> {
  const [r] = await db
    .select({ name: businesses.name, s: businessSettings })
    .from(businesses)
    .innerJoin(businessSettings, eq(businessSettings.businessId, businesses.id))
    .where(eq(businesses.id, businessId));
  if (!r) throw new HttpError(404, "Business not found");
  return {
    name: r.name,
    receiptName: r.s.receiptBusinessName,
    address: r.s.address,
    phone: r.s.phone,
    email: r.s.email,
    logoUrl: r.s.logoUrl,
    footer: r.s.receiptFooter,
    receiptWidth: r.s.receiptWidth,
    currency: r.s.currency,
    locale: r.s.locale,
    timezone: r.s.timezone,
    taxName: r.s.taxName,
  };
}

/** Loads a sale with items, refunds and customer. Always scoped to the business (and optionally cashier). */
export async function getSaleDetail(
  businessId: string,
  saleId: string,
  opts: { cashierId?: string } = {},
): Promise<SaleDetail | null> {
  const [row] = await db
    .select({ sale: sales, cashierName: users.fullName })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.cashierId))
    .where(
      and(
        eq(sales.id, saleId),
        eq(sales.businessId, businessId),
        opts.cashierId ? eq(sales.cashierId, opts.cashierId) : undefined,
      ),
    )
    .limit(1);
  if (!row) return null;
  const s = row.sale;
  const [items, refundRows, customer] = await Promise.all([
    db.select().from(saleItems).where(eq(saleItems.saleId, s.id)).orderBy(saleItems.name),
    db
      .select({ r: refunds, name: users.fullName })
      .from(refunds)
      .leftJoin(users, eq(users.id, refunds.createdBy))
      .where(and(eq(refunds.saleId, s.id), eq(refunds.businessId, businessId)))
      .orderBy(refunds.createdAt),
    s.customerId
      ? db
          .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email })
          .from(customers)
          .where(and(eq(customers.id, s.customerId), eq(customers.businessId, businessId)))
      : Promise.resolve([]),
  ]);
  return {
    id: s.id,
    receiptNumber: s.receiptNumber,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    currency: s.currency,
    subtotal: s.subtotal,
    discountType: s.discountType,
    discountValue: s.discountValue,
    discountAmount: s.discountAmount,
    taxRate: s.taxRate,
    taxInclusive: s.taxInclusive,
    taxAmount: s.taxAmount,
    total: s.total,
    amountPaid: s.amountPaid,
    changeDue: s.changeDue,
    paymentMethod: s.paymentMethod,
    refundedAmount: s.refundedAmount,
    note: s.note,
    cashierName: row.cashierName,
    customer: customer[0] ?? null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      refundedQuantity: i.refundedQuantity,
    })),
    refunds: refundRows.map(({ r, name }) => ({
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      reason: r.reason,
      restocked: r.restocked,
      createdAt: r.createdAt.toISOString(),
      createdByName: name,
    })),
  };
}

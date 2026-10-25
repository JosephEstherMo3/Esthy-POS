import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { parseQuery, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/receipt";
import { resolveRange } from "@/lib/services/catalog";
import { dateStr, uuidField } from "@/lib/validation";

/** CSV exports for authorised users (data.export). */
export const GET = route({ permission: "data.export" }, async ({ url, auth }) => {
  const q = parseQuery(
    url,
    z.object({
      type: z.enum(["sales", "items", "inventory"]),
      from: dateStr.optional(),
      to: dateStr.optional(),
      cashierId: uuidField.optional(),
      method: z.enum(["cash", "transfer", "card"]).optional(),
      status: z.enum(["completed", "partially_refunded", "refunded", "voided"]).optional(),
    }),
  );
  const tz = auth.settings.timezone;
  const biz = auth.business.id;
  let csv = "";
  let name = "";

  if (q.type === "inventory") {
    const r = await db.execute(sql`
      select p.name, p.sku, p.barcode, c.name as category, p.stock_qty, p.price::text, p.cost_price::text,
        (greatest(p.stock_qty,0) * p.cost_price)::text as value_cost, (greatest(p.stock_qty,0) * p.price)::text as value_retail,
        case when p.is_active then 'active' else 'archived' end as status
      from products p left join categories c on c.id = p.category_id where p.business_id = ${biz} order by p.name`);
    csv = toCsv(
      ["Name", "SKU", "Barcode", "Category", "Stock", "Price", "Cost", "Stock value (cost)", "Stock value (retail)", "Status"],
      (r.rows as Record<string, unknown>[]).map((x) => [x.name, x.sku, x.barcode, x.category, x.stock_qty, x.price, x.cost_price, x.value_cost, x.value_retail, x.status]),
    );
    name = "inventory";
  } else {
    const { from, to } = resolveRange(q, tz, 30, 3660);
    const filters = sql`s.business_id = ${biz}
      and s.created_at >= ((${from}::date)::timestamp at time zone ${tz})
      and s.created_at < (((${to}::date) + 1)::timestamp at time zone ${tz})
      ${q.cashierId ? sql`and s.cashier_id = ${q.cashierId}` : sql``}
      ${q.method ? sql`and s.payment_method = ${q.method}` : sql``}
      ${q.status ? sql`and s.status = ${q.status}` : sql``}`;
    if (q.type === "sales") {
      const r = await db.execute(sql`
        select s.receipt_number, to_char(s.created_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI:SS') as created, u.full_name as cashier,
          c.name as customer, s.payment_method::text as method, s.status::text as status, s.currency, s.subtotal::text, s.discount_amount::text,
          s.tax_amount::text, s.total::text, s.amount_paid::text, s.change_due::text, s.refunded_amount::text
        from sales s left join users u on u.id = s.cashier_id left join customers c on c.id = s.customer_id
        where ${filters} order by s.created_at desc limit 50000`);
      csv = toCsv(
        ["Receipt", `Date (${tz})`, "Cashier", "Customer", "Payment method", "Status", "Currency", "Subtotal", "Discount", "Tax", "Total", "Amount paid", "Change", "Refunded"],
        (r.rows as Record<string, unknown>[]).map((x) => [x.receipt_number, x.created, x.cashier, x.customer, x.method, x.status, x.currency, x.subtotal, x.discount_amount, x.tax_amount, x.total, x.amount_paid, x.change_due, x.refunded_amount]),
      );
      name = `sales_${from}_to_${to}`;
    } else {
      const r = await db.execute(sql`
        select s.receipt_number, to_char(s.created_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI:SS') as created, si.name, si.sku, si.quantity,
          si.refunded_quantity, si.unit_price::text, si.line_total::text, s.status::text as status
        from sale_items si join sales s on s.id = si.sale_id
        where ${filters} order by s.created_at desc, si.name limit 100000`);
      csv = toCsv(
        ["Receipt", `Date (${tz})`, "Product", "SKU", "Quantity", "Refunded qty", "Unit price", "Line total", "Sale status"],
        (r.rows as Record<string, unknown>[]).map((x) => [x.receipt_number, x.created, x.name, x.sku, x.quantity, x.refunded_quantity, x.unit_price, x.line_total, x.status]),
      );
      name = `sale_items_${from}_to_${to}`;
    }
  }

  await audit(db, { businessId: biz, userId: auth.user.id, action: "data.exported", entityType: "export", entityId: q.type, metadata: { type: q.type } });
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="charlotte-esthy_${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

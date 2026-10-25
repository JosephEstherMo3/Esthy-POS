import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getBusinessInfo, getSaleDetail, refundSale } from "@/lib/services/sales";
import { uuidField } from "@/lib/validation";

const schema = z.object({
  kind: z.enum(["refund", "void"]),
  items: z.array(z.object({ saleItemId: uuidField, quantity: z.number().int().min(0).max(100_000) })).max(200).optional(),
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300),
  restock: z.boolean().default(true),
});

export const POST = route({ permission: "sales.refund" }, async ({ req, auth, params }) => {
  const saleId = parseId(params.id);
  const input = await readJson(req, schema);
  const result = await refundSale({
    businessId: auth.business.id,
    saleId,
    userId: auth.user.id,
    kind: input.kind,
    items: input.items,
    reason: input.reason,
    restock: input.restock,
  });
  const [sale, business] = await Promise.all([getSaleDetail(auth.business.id, saleId), getBusinessInfo(auth.business.id)]);
  return { result, sale, business };
});

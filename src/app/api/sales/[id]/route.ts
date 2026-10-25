import { HttpError, parseId, route } from "@/lib/api";
import { can } from "@/lib/permissions";
import { getBusinessInfo, getSaleDetail } from "@/lib/services/sales";

export const GET = route({ permission: "sales.view_own" }, async ({ auth, params }) => {
  const id = parseId(params.id);
  const cashierOnly = can(auth.role, "sales.view_all") ? undefined : auth.user.id;
  const [sale, business] = await Promise.all([
    getSaleDetail(auth.business.id, id, { cashierId: cashierOnly }),
    getBusinessInfo(auth.business.id),
  ]);
  if (!sale) throw new HttpError(404, "Sale not found");
  return { sale, business };
});

import { route } from "@/lib/api";
import { getLowStock } from "@/lib/services/reports";

export const GET = route({ permission: "products.view" }, async ({ auth }) => {
  const lowStock = await getLowStock(auth.business.id, auth.settings.defaultLowStockThreshold, 5);
  return { lowStock };
});

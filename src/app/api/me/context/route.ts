import { route } from "@/lib/api";

/** The signed-in user's workspace (user, business, role and display settings). Returns 401 when signed out. */
export const GET = route({}, async ({ auth }) => {
  const s = auth.settings;
  return {
    user: auth.user,
    business: auth.business,
    role: auth.role,
    settings: {
      currency: s.currency,
      locale: s.locale,
      timezone: s.timezone,
      taxName: s.taxName,
      taxRate: s.taxRate,
      taxInclusive: s.taxInclusive,
      defaultLowStockThreshold: s.defaultLowStockThreshold,
      allowNegativeStock: s.allowNegativeStock,
      receiptWidth: s.receiptWidth,
      receiptBusinessName: s.receiptBusinessName,
    },
  };
});

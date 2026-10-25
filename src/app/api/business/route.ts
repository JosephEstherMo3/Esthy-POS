import { route } from "@/lib/api";
import { getBusinessInfo } from "@/lib/services/sales";

/** Business/receipt details (including logo) for receipt previews. Available to every signed-in member. */
export const GET = route({}, async ({ auth }) => {
  return { business: await getBusinessInfo(auth.business.id) };
});

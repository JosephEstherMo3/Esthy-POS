import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceiptView } from "@/components/receipt";
import { buildReceiptText, buildWhatsAppLink, csvEscape, formatReceiptNumber, normalizePhone, toCsv, type BusinessInfo, type SaleDetail } from "@/lib/receipt";

const business: BusinessInfo = {
  name: "Test Shop",
  receiptName: "Charlotte Esthy Boutique",
  address: "12 Market Road",
  phone: "+234 801 000 0000",
  email: "hello@example.com",
  logoUrl: null,
  footer: "Thank you for shopping!",
  receiptWidth: "58mm",
  currency: "USD",
  locale: "en-US",
  timezone: "UTC",
  taxName: "VAT",
};

const sale: SaleDetail = {
  id: "s1",
  receiptNumber: "CE-000042",
  status: "completed",
  createdAt: "2025-03-10T10:15:00Z",
  currency: "USD",
  subtotal: "41.00",
  discountType: "percent",
  discountValue: "10.00",
  discountAmount: "4.10",
  taxRate: "7.50",
  taxInclusive: false,
  taxAmount: "2.77",
  total: "39.67",
  amountPaid: "50.00",
  changeDue: "10.33",
  paymentMethod: "cash",
  refundedAmount: "0.00",
  note: null,
  cashierName: "Ada Cashier",
  customer: { id: "c1", name: "Grace", phone: "+234 801 111 2222", email: null },
  items: [
    { id: "i1", productId: "p1", name: "Rose Serum", sku: "RS-1", quantity: 3, unitPrice: "10.00", lineTotal: "30.00", refundedQuantity: 0 },
    { id: "i2", productId: "p2", name: "Lip Balm", sku: null, quantity: 2, unitPrice: "5.50", lineTotal: "11.00", refundedQuantity: 0 },
  ],
  refunds: [],
};

describe("receipt numbering", () => {
  it("pads sequence numbers with the configured prefix", () => {
    expect(formatReceiptNumber("CE-", 6, 1)).toBe("CE-000001");
    expect(formatReceiptNumber("INV/", 4, 123)).toBe("INV/0123");
    expect(formatReceiptNumber("", 3, 12345)).toBe("12345");
  });
});

describe("receipt rendering", () => {
  const html = renderToStaticMarkup(createElement(ReceiptView, { sale, business }));
  it("contains the required receipt fields", () => {
    for (const text of ["Charlotte Esthy Boutique", "12 Market Road", "CE-000042", "Ada Cashier", "Rose Serum", "Lip Balm", "$39.67", "$50.00", "$10.33", "Thank you for shopping!", "VAT"]) {
      expect(html).toContain(text);
    }
  });
  it("uses the configured paper width", () => {
    expect(html).toContain("width:58mm");
    expect(renderToStaticMarkup(createElement(ReceiptView, { sale, business: { ...business, receiptWidth: "80mm" } }))).toContain("width:80mm");
  });
  it("flags reversed sales and previews", () => {
    expect(renderToStaticMarkup(createElement(ReceiptView, { sale: { ...sale, status: "refunded" }, business }))).toContain("Refunded");
    expect(renderToStaticMarkup(createElement(ReceiptView, { sale, business, preview: true }))).toContain("not yet saved");
  });
});

describe("WhatsApp sharing", () => {
  it("builds a properly encoded wa.me link with digits-only phone", () => {
    const link = buildWhatsAppLink("+234 (801) 111-2222", "Total: $39.67 & thanks\nBye");
    expect(link.startsWith("https://wa.me/2348011112222?text=")).toBe(true);
    expect(link).toContain(encodeURIComponent("Total: $39.67 & thanks\nBye"));
    expect(link).not.toContain(" ");
    expect(link).not.toContain("\n");
  });
  it("works without a phone number", () => {
    expect(buildWhatsAppLink("", "hi")).toBe("https://wa.me/?text=hi");
    expect(normalizePhone(null)).toBe("");
  });
  it("includes receipt details in the message", () => {
    const text = buildReceiptText(sale, business);
    expect(text).toContain("CE-000042");
    expect(text).toContain("3 x Rose Serum");
    expect(text).toContain("Total: USD 39.67");
  });
});

describe("CSV export safety", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvEscape('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralises spreadsheet formula injection but keeps negative numbers", () => {
    expect(csvEscape("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape("+cmd")).toBe("'+cmd");
    expect(csvEscape("-5.00")).toBe("-5.00");
  });
  it("builds rows", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"');
  });
});

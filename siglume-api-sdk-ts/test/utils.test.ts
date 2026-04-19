import { describe, expect, it } from "vitest";

import {
  buildDefaultI18n,
  buildRegistrationStubSource,
  camelCaseFromCapabilityKey,
  coerceMapping,
  parseRetryAfter,
  renderJson,
  stringOrNull,
  toJsonable,
  toRecord,
} from "../src/utils";

describe("utils", () => {
  it("converts rich values to jsonable payloads", () => {
    const value = {
      visible: 1,
      _hidden: "skip",
      nested: [
        {
          to_dict() {
            return { ok: true };
          },
        },
      ],
      jsonLike: {
        toJSON() {
          return { rendered: "yes" };
        },
      },
      weird: new Date("2026-04-19T00:00:00Z"),
    };

    expect(toJsonable(value)).toEqual({
      visible: 1,
      nested: [{ ok: true }],
      jsonLike: { rendered: "yes" },
      weird: "2026-04-19T00:00:00.000Z",
    });
  });

  it("coerces mapping-like objects and renders json consistently", () => {
    expect(coerceMapping({ ok: true }, "payload")).toEqual({ ok: true });
    expect(() => coerceMapping("nope", "payload")).toThrow("payload must be a mapping-like object");
    expect(renderJson({ alpha: 1, beta: null })).toContain("\"alpha\": 1");
  });

  it("handles retry-after parsing and string coercion helpers", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("wat")).toBeNull();
    expect(parseRetryAfter("-1")).toBeNull();
    expect(parseRetryAfter("2")).toBe(2000);
    expect(stringOrNull(undefined)).toBeNull();
    expect(stringOrNull("   ")).toBeNull();
    expect(stringOrNull("  ok ")).toBe("ok");
    expect(toRecord("bad")).toEqual({});
    expect(toRecord({ ok: true })).toEqual({ ok: true });
  });

  it("builds registration helpers from capability metadata", () => {
    expect(camelCaseFromCapabilityKey("price_compare-helper")).toBe("PriceCompareHelperApp");
    expect(camelCaseFromCapabilityKey("")).toBe("GeneratedRegistrationApp");

    const i18n = buildDefaultI18n({
      name: "Quote App",
      job_to_be_done: "Quote a USD charge",
      short_description: "Preview a payment before approval",
    });
    expect(i18n).toEqual({
      job_to_be_done_en: "Quote a USD charge",
      job_to_be_done_ja: "Quote a USD charge",
      short_description_en: "Preview a payment before approval",
      short_description_ja: "Preview a payment before approval",
    });

    const source = buildRegistrationStubSource(
      {
        capability_key: "payment-quote",
        name: "Payment Quote",
      },
      {
        job_to_be_done: "Quote and capture a USD payment",
      },
    );
    expect(source).toContain("class PaymentQuoteApp extends AppAdapter");
    expect(source).toContain("\"capability_key\": \"payment-quote\"");
    expect(source).toContain("\"job_to_be_done\": \"Quote and capture a USD payment\"");
  });
});

import { describe, expect, it } from "vitest";
import { parseCustomerListParams } from "./list-params";
import { customerSchema, toCustomerRow } from "./schemas";

const VALID = {
  name: " Metal d.o.o. ",
  taxId: "4200000000000",
  address: "",
  city: "Zenica",
  country: "",
  contactPerson: "",
  phone: "",
  email: " nabava@metal.ba ",
  notes: "",
};

describe("customerSchema", () => {
  it("trims text and maps empty values to null", () => {
    expect(toCustomerRow(customerSchema.parse(VALID))).toEqual({
      name: "Metal d.o.o.",
      tax_id: "4200000000000",
      address: null,
      city: "Zenica",
      country: null,
      contact_person: null,
      phone: null,
      email: "nabava@metal.ba",
      notes: null,
    });
  });

  it("requires a name and a plausible e-mail", () => {
    const issues = (values: Partial<typeof VALID>) =>
      customerSchema.safeParse({ ...VALID, ...values }).error?.issues.map((i) => i.path[0]) ?? [];
    expect(issues({ name: " " })).toEqual(["name"]);
    expect(issues({ email: "nabava" })).toEqual(["email"]);
    expect(issues({ email: "" })).toEqual([]);
  });
});

describe("parseCustomerListParams", () => {
  it("parses the archive view and drops invalid values", () => {
    expect(parseCustomerListParams({ view: "archived", q: " metal " })).toEqual({
      page: 1,
      pageSize: 25,
      q: "metal",
      view: "archived",
    });
    expect(parseCustomerListParams({ view: "all" }).view).toBeUndefined();
  });
});

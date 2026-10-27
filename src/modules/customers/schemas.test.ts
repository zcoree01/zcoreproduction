import { describe, expect, it } from "vitest";
import { parseCustomerListParams } from "./list-params";
import { customerSchema, toCustomerJson } from "./schemas";

const VALID = {
  customerNumber: "",
  name: " Metal d.o.o. ",
  taxId: "4200000000000",
  address: "",
  postalCode: "",
  city: "Zenica",
  country: "",
  contactPerson: "",
  phone: "",
  email: " nabava@metal.ba ",
  notes: "",
  companyId: "",
};

describe("customerSchema", () => {
  it("trims text and sends empty values as empty strings to save_customer", () => {
    expect(toCustomerJson(customerSchema.parse(VALID))).toEqual({
      customer_number: "",
      name: "Metal d.o.o.",
      tax_id: "4200000000000",
      address: "",
      postal_code: "",
      city: "Zenica",
      country: "",
      contact_person: "",
      phone: "",
      email: "nabava@metal.ba",
      notes: "",
    });
  });

  it("checks Bosnian ID / VAT numbers only for Bosnian customers", () => {
    expect(customerSchema.safeParse({ ...VALID, country: "BA", taxId: "123" }).success).toBe(false);
    expect(
      customerSchema.safeParse({ ...VALID, country: "BA", taxId: "200000000000" }).success,
    ).toBe(true);
    expect(customerSchema.safeParse({ ...VALID, country: "DE", taxId: "123" }).success).toBe(true);
  });

  it("requires a name and a plausible e-mail", () => {
    const issues = (values: Partial<typeof VALID>) =>
      customerSchema.safeParse({ ...VALID, ...values }).error?.issues.map((i) => i.path[0]) ?? [];
    expect(issues({ name: " " })).toEqual(["name"]);
    expect(issues({ email: "nabava" })).toEqual(["email"]);
    expect(issues({ email: "" })).toEqual([]);
  });

  it("numbers customers automatically unless a number is given", () => {
    expect(customerSchema.parse(VALID).customerNumber).toBeNull();
    expect(toCustomerJson(customerSchema.parse(VALID)).customer_number).toBe("");
    const numbered = customerSchema.parse({ ...VALID, customerNumber: " 13 " });
    expect(numbered.customerNumber).toBe(13);
    expect(toCustomerJson(numbered)).toMatchObject({ customer_number: "13" });
    for (const bad of ["0", "-1", "1.5", "1234567", "abc"]) {
      expect(customerSchema.safeParse({ ...VALID, customerNumber: bad }).success).toBe(false);
    }
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

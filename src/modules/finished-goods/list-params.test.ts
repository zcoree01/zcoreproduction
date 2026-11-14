import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE } from "@/lib/data-table/params";
import { parseDeliveryNoteListParams } from "./list-params";

describe("parseDeliveryNoteListParams", () => {
  it("defaults to the first page of all notes", () => {
    expect(parseDeliveryNoteListParams({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      q: "",
      status: undefined,
    });
  });

  it("reads page, size, search and status", () => {
    expect(
      parseDeliveryNoteListParams({
        page: "3",
        pageSize: "50",
        q: " OTP-12 ",
        status: "cancelled",
      }),
    ).toEqual({ page: 3, pageSize: 50, q: "OTP-12", status: "cancelled" });
  });

  it("ignores an unknown status instead of failing", () => {
    expect(parseDeliveryNoteListParams({ status: "draft" }).status).toBeUndefined();
    expect(parseDeliveryNoteListParams({ status: ["issued", "x"] }).status).toBe("issued");
  });
});

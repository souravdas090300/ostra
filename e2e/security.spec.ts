import { test, expect } from "@playwright/test";

const REQUIRED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
];

test.describe("security headers", () => {
  test("all required headers are present", async ({ request }) => {
    const res = await request.get("/login");
    const headers = res.headers();
    for (const name of REQUIRED_HEADERS) {
      expect(headers[name], name).toBeTruthy();
    }
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});

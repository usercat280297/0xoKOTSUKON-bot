import { describe, expect, it } from "vitest";
import { PermissionService } from "../src/services/permissionService";

describe("PermissionService", () => {
  const service = new PermissionService();

  it("accepts members with the required role", () => {
    expect(service.hasRequiredRole(["role-a", "role-b"], "role-b")).toBe(true);
  });

  it("rejects members without the required role", () => {
    expect(service.hasRequiredRole(["role-a"], "role-b")).toBe(false);
  });

  it("allows ticket close for requester even without staff role", () => {
    expect(service.canCloseTicket("user-1", "user-1", [], "staff-role", false)).toBe(true);
  });

  it("allows staff override with manage channels", () => {
    expect(service.isStaff([], "staff-role", true)).toBe(true);
  });
});

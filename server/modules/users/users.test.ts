import { describe, expect, it } from "vitest";
import { userPasswordInput, userProfileInput } from "../../../shared/users";
describe("user account input", () => {
  it("requires password confirmation and at least twelve characters", () => {
    expect(
      userPasswordInput.safeParse({
        userId: 1,
        password: "short",
        confirmation: "short",
      }).success
    ).toBe(false);
    expect(
      userPasswordInput.safeParse({
        userId: 1,
        password: "Valid-Password-123",
        confirmation: "Different-Password",
      }).success
    ).toBe(false);
    expect(
      userPasswordInput.safeParse({
        userId: 1,
        password: "Valid-Password-123",
        confirmation: "Valid-Password-123",
      }).success
    ).toBe(true);
  });
  it("normalizes usernames and permits clearing an optional email", () => {
    expect(
      userProfileInput.parse({
        userId: 1,
        username: "  Example.User  ",
        name: "Example",
        email: "",
        locale: "ar",
      }).username
    ).toBe("example.user");
    expect(
      userProfileInput.safeParse({
        userId: 1,
        username: "space name",
        name: "Example",
        email: "not-an-email",
        locale: "ar",
      }).success
    ).toBe(false);
  });
});

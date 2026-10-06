import { describe, expect, it } from "vitest";

import { inverseRelationshipType, relationshipTypes, relationshipTypeSchema } from "./relationship";

describe("relationshipTypeSchema", () => {
  it("accepts every canonical type", () => {
    for (const type of relationshipTypes) {
      expect(relationshipTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects an unknown type", () => {
    expect(() => relationshipTypeSchema.parse("roommate")).toThrow();
  });
});

describe("inverseRelationshipType", () => {
  it("is its own inverse for every type (applying it twice returns the original)", () => {
    for (const type of relationshipTypes) {
      expect(inverseRelationshipType(inverseRelationshipType(type))).toBe(type);
    }
  });

  it("maps asymmetric pairs correctly", () => {
    expect(inverseRelationshipType("parent")).toBe("child");
    expect(inverseRelationshipType("grandparent")).toBe("grandchild");
    expect(inverseRelationshipType("aunt_uncle")).toBe("niece_nephew");
  });

  it("maps symmetric types to themselves", () => {
    expect(inverseRelationshipType("spouse")).toBe("spouse");
    expect(inverseRelationshipType("sibling")).toBe("sibling");
    expect(inverseRelationshipType("friend")).toBe("friend");
  });
});

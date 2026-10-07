import { describe, expect, it } from "vitest";

import {
  inverseRelationshipType,
  relationshipLabel,
  relationshipTypes,
  relationshipTypeSchema,
} from "./relationship";

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

describe("relationshipLabel", () => {
  it("returns the neutral term for every type when gender is neutral", () => {
    expect(relationshipLabel("parent", "neutral")).toBe("Parent");
    expect(relationshipLabel("child", "neutral")).toBe("Child");
    expect(relationshipLabel("friend", "neutral")).toBe("Friend");
  });

  it("returns the gendered pair for types that have one", () => {
    expect(relationshipLabel("parent", "masculine")).toBe("Father");
    expect(relationshipLabel("parent", "feminine")).toBe("Mother");
    expect(relationshipLabel("child", "masculine")).toBe("Son");
    expect(relationshipLabel("child", "feminine")).toBe("Daughter");
    expect(relationshipLabel("sibling", "masculine")).toBe("Brother");
    expect(relationshipLabel("sibling", "feminine")).toBe("Sister");
    expect(relationshipLabel("grandparent", "masculine")).toBe("Grandfather");
    expect(relationshipLabel("grandchild", "feminine")).toBe("Granddaughter");
    expect(relationshipLabel("aunt_uncle", "masculine")).toBe("Uncle");
    expect(relationshipLabel("niece_nephew", "feminine")).toBe("Niece");
    expect(relationshipLabel("spouse", "masculine")).toBe("Husband");
    expect(relationshipLabel("spouse", "feminine")).toBe("Wife");
  });

  it("falls back to the neutral term for types with no clean gendered pair", () => {
    expect(relationshipLabel("partner", "masculine")).toBe("Partner");
    expect(relationshipLabel("cousin", "feminine")).toBe("Cousin");
    expect(relationshipLabel("in_law", "masculine")).toBe("In-law");
    expect(relationshipLabel("friend", "feminine")).toBe("Friend");
  });
});

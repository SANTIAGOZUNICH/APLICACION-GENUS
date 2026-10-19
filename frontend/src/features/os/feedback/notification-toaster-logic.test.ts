import { describe, expect, it } from "vitest";
import { parseShownIds, pickToastsToShow, serializeShownIds } from "./notification-toaster-logic";

const now = Date.parse("2026-10-19T12:00:00Z");
const n = (id: string, read: boolean, h: number) => ({ id, read, createdAt: new Date(now - h * 3600_000).toISOString() });

describe("pickToastsToShow", () => {
  it("muestra solo no leídas, recientes y no mostradas, la más nueva primero", () => {
    const out = pickToastsToShow([n("a", false, 5), n("b", true, 1), n("c", false, 1), n("d", false, 30), n("e", false, 2)], new Set(["e"]), now);
    expect(out.map((x) => x.id)).toEqual(["c", "a"]);
  });
  it("no repite lo ya mostrado (recarga de página)", () => {
    const shown = parseShownIds(serializeShownIds(new Set(["a"])));
    expect(pickToastsToShow([n("a", false, 1)], shown, now)).toEqual([]);
  });
  it("tolera almacenamiento corrupto", () => {
    expect(parseShownIds("{no json").size).toBe(0);
    expect(parseShownIds(null).size).toBe(0);
  });
});

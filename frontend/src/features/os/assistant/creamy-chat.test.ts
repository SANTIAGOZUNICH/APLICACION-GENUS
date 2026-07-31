import { describe, expect, it } from "vitest";
import { parseNavActionsFromReply, stripNavActionsLine } from "./creamy-chat";

describe("parseNavActionsFromReply", () => {
  it("parses NAV_ACTIONS line from assistant reply", () => {
    const content =
      "Podés ir a Ingresos MP.\nNAV_ACTIONS: mp_ingresos|IR A INGRESOS MP;remitos|IR A REMITOS";
    expect(parseNavActionsFromReply(content)).toEqual([
      { sidebarId: "mp_ingresos", label: "IR A INGRESOS MP" },
      { sidebarId: "remitos", label: "IR A REMITOS" },
    ]);
    expect(stripNavActionsLine(content)).toBe("Podés ir a Ingresos MP.");
  });
});

/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSortPreference } from "./use-sort-preference";

afterEach(() => {
  window.localStorage.clear();
});

describe("useSortPreference", () => {
  it("sin preferencia guardada, usa defaultKey", () => {
    const { result } = renderHook(() => useSortPreference("pantalla-sin-pref", "fecha_desc"));
    expect(result.current[0]).toBe("fecha_desc");
  });

  it("aplica la preferencia guardada después de montar", async () => {
    window.localStorage.setItem("genus_os_sort_pref:pantalla-x", "fecha_asc");
    const { result } = renderHook(() => useSortPreference("pantalla-x", "fecha_desc"));
    await act(async () => {});
    expect(result.current[0]).toBe("fecha_asc");
  });

  it("cambiar el orden lo persiste en localStorage bajo esta pantalla", () => {
    const { result } = renderHook(() => useSortPreference("pantalla-y", "fecha_desc"));
    act(() => result.current[1]("producto_asc"));
    expect(result.current[0]).toBe("producto_asc");
    expect(window.localStorage.getItem("genus_os_sort_pref:pantalla-y")).toBe("producto_asc");
  });

  it("pantallas distintas no se pisan entre sí", () => {
    const a = renderHook(() => useSortPreference("pantalla-a", "fecha_desc"));
    const b = renderHook(() => useSortPreference("pantalla-b", "fecha_desc"));
    act(() => a.result.current[1]("numero_asc"));
    act(() => b.result.current[1]("cantidad_desc"));
    expect(window.localStorage.getItem("genus_os_sort_pref:pantalla-a")).toBe("numero_asc");
    expect(window.localStorage.getItem("genus_os_sort_pref:pantalla-b")).toBe("cantidad_desc");
  });

  it("descarta una preferencia guardada que ya no es válida (ej. tras cambiar las opciones)", async () => {
    window.localStorage.setItem("genus_os_sort_pref:pantalla-z", "opcion_vieja_eliminada");
    const { result } = renderHook(() =>
      useSortPreference("pantalla-z", "fecha_desc", ["fecha_desc", "fecha_asc"])
    );
    await act(async () => {});
    expect(result.current[0]).toBe("fecha_desc");
  });

  it("si localStorage no está disponible, no rompe — sigue funcionando en memoria", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const { result } = renderHook(() => useSortPreference("pantalla-full", "fecha_desc"));
    expect(() => act(() => result.current[1]("producto_asc"))).not.toThrow();
    expect(result.current[0]).toBe("producto_asc");
    window.localStorage.setItem = original;
  });
});

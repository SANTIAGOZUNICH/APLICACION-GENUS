"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canOrderAction } from "@/lib/orders/rbac";
import {
  emptyOeMaterial,
  emptyOaMaterial,
  formulaFingerprint,
  normalizeOrderContent,
  recomputeOeDerived,
  recomputeOaDerived,
} from "@/lib/orders/content";
import { didFormulaChange } from "@/lib/orders/oe-ajuste";
import {
  archiveOrderApi,
  deleteEmptyDraftApi,
  deliverOrderApi,
  fetchOrder,
  orderPdfUrl,
  resolveFormulaMasterApi,
  reviewOrderApi,
  returnOrderApi,
  saveAsMasterApi,
  saveOrderProgressApi,
} from "@/lib/orders/orders-client";
import { canDeleteEmptyDraft } from "@/lib/orders/empty-draft";
import { statusLabel } from "@/lib/orders/empty-draft";
import type { OaContent, OeContent, OperationalOrderRecord, OrderContent } from "@/lib/orders/types";
import { validateDeliver } from "@/lib/orders/validators";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/orders/actor";
import {
  applyFormulaResolveToOe,
  formulaIdentityKey,
  messageForResolveReason,
  needsReplaceConfirmation,
  oeHasFormulaContent,
  type FormulaAutoloadStatus,
} from "../lib/oe-formula-autoload";
import { OeFormSections } from "./oe-form-sections";
import type { SelectedFormulaOption } from "./formula-client-product-pickers";
import { fetchFormulaProductOptionsApi } from "@/lib/orders/orders-client";
import { OaFormSections, renumberOaMaterials } from "./oa-form-sections";
import { OaSimpleWizard } from "./oa-simple-wizard";
import { LegalOrderPreview } from "./legal-order-preview";
import {
  initOaSimpleFormFromLegal,
  mapOASimpleFormToLegalDocument,
  type OaSimpleForm,
} from "@/lib/orders/oa-simple-form";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type OaEditorMode = "simple" | "full";

interface OperationalOrderEditorProps {
  orderId: string;
  onClose: () => void;
}

export function OperationalOrderEditor({ orderId, onClose }: OperationalOrderEditorProps) {
  const { sectorId, email } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

  const [order, setOrder] = useState<OperationalOrderRecord | null>(null);
  const [form, setForm] = useState<OrderContent | null>(null);
  const formRef = useRef<OrderContent | null>(null);
  formRef.current = form;
  const [oaSimple, setOaSimple] = useState<OaSimpleForm | null>(null);
  const [oaMode, setOaMode] = useState<OaEditorMode>("simple");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<OperationalOrderRecord | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [masterReason, setMasterReason] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [meShortages, setMeShortages] = useState<
    Array<{
      codigo: string;
      material: string;
      stockDisponible: number;
      cantidadSolicitada: number;
      diferencia: number;
    }>
  >([]);
  const [meShortageOpen, setMeShortageOpen] = useState(false);
  const [meShortageReason, setMeShortageReason] = useState("");
  const [pendingAllowIncomplete, setPendingAllowIncomplete] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(1);
  const [formulaStatus, setFormulaStatus] = useState<FormulaAutoloadStatus>("idle");
  const [formulaStatusDetail, setFormulaStatusDetail] = useState<string | undefined>();
  const [formulaReplaceOpen, setFormulaReplaceOpen] = useState(false);
  const [didYouMean, setDidYouMean] = useState<SelectedFormulaOption | null>(null);
  const [boundProductId, setBoundProductId] = useState<string | null>(null);
  const formulaIdentityRef = useRef<string | null>(null);
  const formulaResolveSeq = useRef(0);
  const pendingResolvePayloadRef = useRef<Awaited<
    ReturnType<typeof resolveFormulaMasterApi>
  > | null>(null);
  const pendingFormulaIdentityRef = useRef<string | null>(null);
  const formulaSnapshotRef = useRef<{
    formulaProductId: string | null;
    formulaVersionId: string | null;
    formulaVersionHash: string | null;
  }>({
    formulaProductId: null,
    formulaVersionId: null,
    formulaVersionHash: null,
  });

  const load = useCallback(async () => {
    try {
      const o = await fetchOrder(session, orderId);
      setOrder(o);
      setForm(o.formData);
      if (o.formData.kind === "OA") {
        setOaSimple(
          initOaSimpleFormFromLegal(o.formData, {
            sector:
              o.assignedSector === "ENVASADO_PREMIUM"
                ? "ENVASADO_PREMIUM"
                : o.assignedSector === "ENVASADO_MASIVO"
                  ? "ENVASADO_MASIVO"
                  : "",
          })
        );
        setOaMode("simple");
      } else {
        setOaSimple(null);
      }
      versionRef.current = o.version;
      formulaSnapshotRef.current = {
        formulaProductId: o.formulaProductId,
        formulaVersionId: o.formulaVersionId,
        formulaVersionHash: o.formulaVersionHash,
      };
      setBoundProductId(o.formulaProductId);
      setDidYouMean(null);
      if (o.formData.kind === "OE") {
        const client = o.formData.header.client.trim();
        const product = o.formData.header.productName.trim();
        formulaIdentityRef.current =
          client && product ? formulaIdentityKey(client, product) : null;
        if (!client) setFormulaStatus("select_client");
        else if (!product) setFormulaStatus("select_product");
        else if (o.formulaVersionId) setFormulaStatus("found");
        else setFormulaStatus("idle");
      } else {
        formulaIdentityRef.current = null;
        setFormulaStatus("idle");
      }
      setFormulaStatusDetail(undefined);
      setSaveState("idle");
      setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la orden.");
    }
  }, [session, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const locked =
    order?.status === "COMPLETA" ||
    order?.status === "COMPLETA_CON_PENDIENTES" ||
    order?.status === "ARCHIVADA" ||
    order?.status === "ANULADA";

  const canDeleteDraft =
    !!order &&
    !!email &&
    canDeleteEmptyDraft(order, {
      email,
      sector: sectorId,
      displayName: email,
    });

  const canEdit =
    !!order &&
    !locked &&
    (canOrderAction(order.type, "edit", sectorId) ||
      canOrderAction(order.type, "edit_formula", sectorId) ||
      canOrderAction(order.type, "edit_codificado", sectorId));
  const canEditFormula =
    !!order && order.type === "OE" && !locked && canOrderAction("OE", "edit_formula", sectorId);
  const canEditOperational =
    !!order && order.type === "OE" && !locked && canOrderAction("OE", "edit", sectorId);
  const canDeliver = !!order && canOrderAction(order.type, "deliver", sectorId) && !locked;
  const canMaster =
    !!order &&
    (canOrderAction(order.type, "save_as_master", sectorId) ||
      canOrderAction(order.type, "propose_master", sectorId));
  const canReview = !!order && canOrderAction(order.type, "review", sectorId);
  const canReturn = !!order && canOrderAction(order.type, "return", sectorId);
  const canArchive = !!order && canOrderAction(order.type, "archive", sectorId);
  const canDownload = !!order && canOrderAction(order.type, "download", sectorId);

  const [formulaPromptOpen, setFormulaPromptOpen] = useState(false);
  const [pendingFormulaForm, setPendingFormulaForm] = useState<OrderContent | null>(null);
  const formulaBaselineRef = useRef<OeContent | null>(null);

  useEffect(() => {
    if (order?.formData.kind === "OE") {
      formulaBaselineRef.current = order.formData;
    }
  }, [order?.id, order?.formData]);

  // silence unused helper import used for baseline compare in update path
  void formulaFingerprint;

  const persist = useCallback(
    async (nextForm: OrderContent, expectedVersion: number) => {
      setSaveState("saving");
      try {
        const updated = await saveOrderProgressApi(session, orderId, {
          expectedVersion,
          formData: nextForm,
          formulaProductId: formulaSnapshotRef.current.formulaProductId,
          formulaVersionId: formulaSnapshotRef.current.formulaVersionId,
          formulaVersionHash: formulaSnapshotRef.current.formulaVersionHash,
        });
        setOrder(updated);
        setForm(updated.formData);
        formulaSnapshotRef.current = {
          formulaProductId: updated.formulaProductId,
          formulaVersionId: updated.formulaVersionId,
          formulaVersionHash: updated.formulaVersionHash,
        };
        if (updated.formData.kind === "OA") {
          const oaForm = updated.formData;
          setOaSimple((prev) =>
            prev
              ? prev
              : initOaSimpleFormFromLegal(oaForm, {
                  sector:
                    updated.assignedSector === "ENVASADO_PREMIUM"
                      ? "ENVASADO_PREMIUM"
                      : updated.assignedSector === "ENVASADO_MASIVO"
                        ? "ENVASADO_MASIVO"
                        : "",
                })
          );
        }
        versionRef.current = updated.version;
        setSaveState("saved");
        setConflict(null);
        setError(null);
      } catch (err) {
        const current = (err as { current?: OperationalOrderRecord }).current;
        if (current) {
          setConflict(current);
          setSaveState("error");
          setError("Conflicto de edición: otro usuario modificó la orden.");
        } else {
          setSaveState("error");
          setError(err instanceof Error ? err.message : "Error al guardar.");
        }
      }
    },
    [session, orderId]
  );

  const applyResolvedFormula = useCallback(
    (payload: Awaited<ReturnType<typeof resolveFormulaMasterApi>>, identity: string) => {
      setForm((prev) => {
        if (!prev || prev.kind !== "OE") return prev;
        const applied = applyFormulaResolveToOe(prev, payload);
        if (!applied) return prev;
        formulaIdentityRef.current = identity;
        formulaSnapshotRef.current = {
          formulaProductId: applied.formulaProductId,
          formulaVersionId: applied.formulaVersionId,
          formulaVersionHash: applied.formulaVersionHash,
        };
        setBoundProductId(applied.formulaProductId);
        setDidYouMean(null);
        const withCode =
          payload.snapshot?.productCode
            ? {
                ...applied.content,
                header: {
                  ...applied.content.header,
                  code: payload.snapshot.productCode || applied.content.header.code,
                },
              }
            : applied.content;
        const next = normalizeOrderContent(withCode);
        setSaveState("dirty");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void persist(next, versionRef.current);
        }, 400);
        return next;
      });
      setFormulaStatus("found");
      setFormulaStatusDetail(undefined);
    },
    [persist]
  );

  const invalidateBoundFormula = useCallback(() => {
    setBoundProductId(null);
    formulaSnapshotRef.current = {
      formulaProductId: null,
      formulaVersionId: null,
      formulaVersionHash: null,
    };
    formulaIdentityRef.current = null;
    setDidYouMean(null);
    // No borrar materiales aquí: el replace se confirma al resolver una nueva fórmula.
  }, []);

  const runFormulaResolve = useCallback(
    async (
      client: string,
      product: string,
      forceReplace: boolean,
      productId?: string,
      driveFileId?: string
    ) => {
      if (!canEditFormula || locked) return;
      const identity = formulaIdentityKey(client, product);
      const seq = ++formulaResolveSeq.current;
      setFormulaStatus("searching");
      setFormulaStatusDetail(undefined);
      setDidYouMean(null);
      try {
        const result = await resolveFormulaMasterApi(
          session,
          client,
          product,
          productId,
          driveFileId
        );
        if (seq !== formulaResolveSeq.current) return;

        if (result.persistenceReady === false) {
          setFormulaStatus("error");
          setError("El banco de fórmulas no está disponible (base Preview no configurada).");
          return;
        }
        if (result.conflict) {
          setFormulaStatus("conflict");
          setFormulaStatusDetail(result.message);
          return;
        }
        if (!result.found) {
          if (result.reason === "ambiguous") {
            setFormulaStatus("multiple");
            return;
          }
          // Sugerencia única de alta confianza (solo UI; no carga sola).
          if (!productId && client.trim() && product.trim()) {
            try {
              const opts = await fetchFormulaProductOptionsApi(
                session,
                client,
                product
              );
              const high = opts.products.filter(
                (p) => p.rank === "exact_prefix" || p.rank === "word_prefix"
              );
              if (high.length === 1) {
                const only = high[0]!;
                setDidYouMean({
                  productId: only.productId,
                  versionId: only.versionId,
                  client: only.client,
                  productLabel: only.productLabel,
                  code: only.code,
                });
                setFormulaStatus("did_you_mean");
                setFormulaStatusDetail(only.productLabel);
                return;
              }
              if (opts.products.length > 1) {
                setFormulaStatus("multiple");
                return;
              }
            } catch {
              /* ignore suggestion fetch */
            }
          }
          setFormulaStatus("not_found");
          setFormulaStatusDetail(
            messageForResolveReason(result.reason, result.message)
          );
          return;
        }

        const current = formRef.current;
        const hasContent =
          current?.kind === "OE" ? oeHasFormulaContent(current) : false;
        const confirmNeeded =
          !forceReplace &&
          needsReplaceConfirmation({
            previousIdentity: formulaIdentityRef.current,
            nextIdentity: identity,
            hasContent,
          });

        if (confirmNeeded) {
          pendingFormulaIdentityRef.current = identity;
          pendingResolvePayloadRef.current = result;
          setFormulaStatus("awaiting_confirm");
          setFormulaReplaceOpen(true);
          return;
        }

        applyResolvedFormula(result, identity);
        if (result.source === "DRIVE") {
          setFormulaStatus("found");
          setFormulaStatusDetail("Fórmula encontrada en Drive");
        }
      } catch (err) {
        if (seq !== formulaResolveSeq.current) return;
        setFormulaStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "No pudimos consultar el banco de fórmulas"
        );
      }
    },
    [canEditFormula, locked, session, applyResolvedFormula]
  );

  const canEditRef = useRef(false);
  canEditRef.current = canEdit;

  // updateForm vía setState funcional: no cerrar sobre `form` (evita no-op stale
  // cuando onClientTextChange se memoiza con form===null del primer render).
  const updateForm = useCallback(
    (updater: (prev: OrderContent) => OrderContent) => {
      setForm((prev) => {
        if (!prev || !canEditRef.current) return prev;
        const next = normalizeOrderContent(updater(prev));
        setSaveState("dirty");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void persist(next, versionRef.current);
        }, 900);
        return next;
      });
    },
    [persist]
  );

  // Sin auto-resolve por texto: solo selección explícita / exacto único en Enter.
  // Al tipear Cliente NO se limpia producto en cada tecla (el picker lo hace al invalidar selección).
  const onClientTextChange = useCallback(
    (nextClient: string) => {
      updateForm((prev) => {
        if (prev.kind !== "OE") return prev;
        return {
          ...prev,
          header: { ...prev.header, client: nextClient },
        };
      });
      setFormulaStatus(nextClient.trim() ? "select_product" : "select_client");
      setFormulaStatusDetail(undefined);
    },
    [updateForm]
  );

  const onProductTextChange = useCallback(
    (nextProduct: string) => {
      updateForm((prev) => {
        if (prev.kind !== "OE") return prev;
        return {
          ...prev,
          header: { ...prev.header, productName: nextProduct },
        };
      });
      if (boundProductId) {
        invalidateBoundFormula();
      }
      setFormulaStatus("select_product");
      setFormulaStatusDetail(undefined);
      setDidYouMean(null);
    },
    [boundProductId, invalidateBoundFormula, updateForm]
  );

  const onClientSelected = useCallback(
    (nextClient: string) => {
      updateForm((prev) => {
        if (prev.kind !== "OE") return prev;
        return {
          ...prev,
          header: { ...prev.header, client: nextClient, productName: "" },
        };
      });
      invalidateBoundFormula();
      setFormulaStatus("select_product");
      setFormulaStatusDetail(undefined);
    },
    [invalidateBoundFormula, updateForm]
  );

  const onProductSelected = useCallback(
    (option: SelectedFormulaOption) => {
      updateForm((prev) => {
        if (prev.kind !== "OE") return prev;
        return {
          ...prev,
          header: {
            ...prev.header,
            client: option.client,
            productName: option.productLabel,
            code: option.code || prev.header.code,
          },
        };
      });
      void runFormulaResolve(
        option.client,
        option.productLabel,
        false,
        option.productId,
        option.driveFileId
      );
    },
    [runFormulaResolve, updateForm]
  );

  const onCommitProductText = useCallback(
    (client: string, product: string) => {
      // Texto libre: intentar exacto único vía API (aliases). Nunca fuzzy auto-load.
      void runFormulaResolve(client, product, false);
    },
    [runFormulaResolve]
  );

  const oeClient = form?.kind === "OE" ? form.header.client : "";
  const oeProduct = form?.kind === "OE" ? form.header.productName : "";

  // Fallback: autoload exacto por texto (debounce), aunque el combobox/options falle.
  useEffect(() => {
    if (!canEditFormula || locked) return;
    const client = oeClient.trim();
    const product = oeProduct.trim();
    if (!client || !product) return;
    const identity = formulaIdentityKey(client, product);
    if (
      identity === formulaIdentityRef.current &&
      formulaSnapshotRef.current.formulaVersionId &&
      formRef.current?.kind === "OE" &&
      formRef.current.materials.some((m) => m.formulaPct != null)
    ) {
      return;
    }
    const t = setTimeout(() => {
      void runFormulaResolve(client, product, false);
    }, 550);
    return () => clearTimeout(t);
  }, [oeClient, oeProduct, canEditFormula, locked, runFormulaResolve]);

  const updateOaSimple = (nextSimple: OaSimpleForm) => {
    if (!canEdit && sectorId !== "CODIFICADO") return;
    if (!canEdit && !canOrderAction("OA", "edit_codificado", sectorId)) return;
    setOaSimple(nextSimple);
    const legal = mapOASimpleFormToLegalDocument(
      nextSimple,
      form?.kind === "OA" ? form : undefined
    );
    updateForm(() => legal);
  };

  const saveNow = async () => {
    if (!form) return;
    if (
      canEditFormula &&
      form.kind === "OE" &&
      formulaBaselineRef.current &&
      didFormulaChange(formulaBaselineRef.current, form)
    ) {
      setPendingFormulaForm(form);
      setFormulaPromptOpen(true);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await persist(form, versionRef.current);
  };

  const applyFormulaOrderOnly = async () => {
    const pending = pendingFormulaForm;
    if (!pending) return;
    setFormulaPromptOpen(false);
    setPendingFormulaForm(null);
    if (pending.kind === "OE") {
      formulaBaselineRef.current = pending;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await persist(pending, versionRef.current);
  };

  const applyFormulaAndProposeMaster = async () => {
    await applyFormulaOrderOnly();
    setMasterOpen(true);
  };

  const onDeliver = async (
    allowIncomplete = false,
    meOpts?: { allowNegativeMeStock?: boolean; negativeMeStockReason?: string }
  ) => {
    if (!form) return;
    const missing = validateDeliver(form);
    if (missing.length && !allowIncomplete) {
      setMissingFields(missing);
      setDeliverOpen(true);
      return;
    }
    setMissingFields([]);
    try {
      const updated = await deliverOrderApi(session, orderId, {
        allowIncomplete: allowIncomplete || missing.length > 0,
        allowNegativeMeStock: meOpts?.allowNegativeMeStock,
        negativeMeStockReason: meOpts?.negativeMeStockReason,
      });
      setOrder(updated);
      setForm(updated.formData);
      versionRef.current = updated.version;
      setDeliverOpen(false);
      setMeShortageOpen(false);
      setMeShortages([]);
      setMeShortageReason("");
      setSaveState("saved");
    } catch (err) {
      const e = err as Error & {
        code?: string;
        shortages?: typeof meShortages;
      };
      if (e.code === "ME_STOCK_SHORTAGE" && e.shortages?.length) {
        setMeShortages(e.shortages);
        setPendingAllowIncomplete(allowIncomplete || missing.length > 0);
        setMeShortageOpen(true);
        setDeliverOpen(false);
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo entregar.");
    }
  };

  const onMaster = async () => {
    try {
      await saveAsMasterApi(session, orderId, masterReason);
      setMasterOpen(false);
      setMasterReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar como maestra.");
    }
  };

  const downloadPdf = async () => {
    if (!order) return;
    const res = await fetch(orderPdfUrl(order.id), {
      headers: {
        [ACTOR_EMAIL_HEADER]: session.email,
        [ACTOR_SECTOR_HEADER]: session.sector,
      },
    });
    if (!res.ok) {
      setError("No se pudo descargar el PDF.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${order.orderNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !order) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
        <div className="mt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  if (!order || !form) {
    return <p className="text-sm text-[var(--os-text-muted)]">Cargando orden…</p>;
  }

  const saveLabel =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? "Cambios guardados"
        : saveState === "dirty"
          ? "Sin guardar"
          : saveState === "error"
            ? "Error al guardar"
            : "Sin cambios";

  return (
    <div className="space-y-4 rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-xs text-[var(--os-teal)] hover:underline"
            onClick={onClose}
          >
            ← Volver al listado
          </button>
          <h3 className="text-lg font-semibold">
            {order.orderNumber} · {order.product}
          </h3>
          <p className="text-xs text-[var(--os-text-muted)]">
            {statusLabel(order.status)} · plantilla v{order.templateVersion} · rev {order.revision} ·
            sector {order.assignedSector}
          </p>
          <p className="mt-1 text-sm">
            Completado: <strong>{order.completionPercentage}%</strong>
            <span className="ml-3 text-xs text-[var(--os-text-muted)]">{saveLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button type="button" variant="secondary" onClick={() => void saveNow()} data-testid="guardar-avance">
              Guardar avance
            </Button>
          )}
          {canDeleteDraft && (
            <Button
              type="button"
              variant="secondary"
              data-testid="eliminar-borrador"
              onClick={() => {
                if (
                  !window.confirm(
                    "¿Querés eliminar este borrador? Esta acción no afectará plantillas ni otras órdenes."
                  )
                ) {
                  return;
                }
                void deleteEmptyDraftApi(session, orderId).then(() => onClose());
              }}
            >
              Eliminar borrador
            </Button>
          )}
          {canMaster && (
            <Button type="button" variant="secondary" onClick={() => setMasterOpen(true)}>
              {canOrderAction(order.type, "save_as_master", sectorId)
                ? "Guardar como maestra"
                : "Proponer como maestra"}
            </Button>
          )}
          {canDeliver && (
            <Button
              type="button"
              onClick={() => {
                if (form) setMissingFields(validateDeliver(form));
                setDeliverOpen(true);
              }}
            >
              Entregar
            </Button>
          )}
          {canReview && order.status === "COMPLETA" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void reviewOrderApi(session, orderId).then(setOrder)}
            >
              Confirmar revisada
            </Button>
          )}
          {canReturn && order.status === "COMPLETA" && (
            <Button type="button" variant="secondary" onClick={() => setReturnOpen(true)}>
              Devolver para corrección
            </Button>
          )}
          {canArchive && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void archiveOrderApi(session, orderId).then(setOrder)}
            >
              Archivar
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setShowPreview((v) => !v)}>
            Vista previa PDF
          </Button>
          {canDownload && (
            <Button type="button" onClick={() => void downloadPdf()}>
              Descargar PDF
            </Button>
          )}
          {canDownload && (
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              Imprimir
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      {conflict && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          Conflicto detectado (versión {conflict.version}).{" "}
          <button
            type="button"
            className="font-medium text-[var(--os-teal)] underline"
            onClick={() => {
              setOrder(conflict);
              setForm(conflict.formData);
              if (conflict.formData.kind === "OA") {
                setOaSimple(
                  initOaSimpleFormFromLegal(conflict.formData, {
                    sector:
                      conflict.assignedSector === "ENVASADO_PREMIUM"
                        ? "ENVASADO_PREMIUM"
                        : conflict.assignedSector === "ENVASADO_MASIVO"
                          ? "ENVASADO_MASIVO"
                          : "",
                  })
                );
              }
              versionRef.current = conflict.version;
              setConflict(null);
              setSaveState("idle");
            }}
          >
            Actualizar y revisar diferencias
          </button>
        </div>
      )}
      {locked && (
        <p className="text-sm text-[var(--os-text-muted)]">
          Orden {order.status}: no editable directamente. Usá devolución para corrección si
          corresponde.
        </p>
      )}

      {showPreview ? (
        <LegalOrderPreview order={{ ...order, formData: form }} />
      ) : form.kind === "OE" ? (
        <OeFormSections
          content={form}
          hydrateKey={orderId}
          fieldMode={{
            canEditFormula,
            canEditOperational: canEditOperational || canEditFormula,
            actorEmail: email ?? undefined,
          }}
          formulaStatus={formulaStatus}
          formulaStatusDetail={formulaStatusDetail}
          session={session}
          selectedProductId={boundProductId}
          didYouMean={didYouMean}
          onAcceptDidYouMean={() => {
            if (!didYouMean) return;
            onProductSelected(didYouMean);
          }}
          onClientTextChange={onClientTextChange}
          onProductTextChange={onProductTextChange}
          onClientSelected={onClientSelected}
          onProductSelected={onProductSelected}
          onCommitProductText={onCommitProductText}
          onChange={(next) => updateForm(() => recomputeOeDerived(next))}
          onAddMaterial={() =>
            updateForm((prev) => {
              if (prev.kind !== "OE") return prev;
              return { ...prev, materials: [...prev.materials, emptyOeMaterial()] };
            })
          }
          onRemoveMaterial={(id) =>
            updateForm((prev) => {
              if (prev.kind !== "OE") return prev;
              return { ...prev, materials: prev.materials.filter((m) => m.id !== id) };
            })
          }
        />
      ) : oaMode === "simple" && oaSimple ? (
        <OaSimpleWizard
          simple={oaSimple}
          legalBase={form}
          readOnly={!canEdit && sectorId !== "CODIFICADO"}
          codificadoOnly={sectorId === "CODIFICADO"}
          onChange={updateOaSimple}
          onRequestFullForm={() => {
            setOaMode("full");
          }}
          onPreview={() => setShowPreview(true)}
          onSaveProgress={() => void saveNow()}
          onDeliver={() => setDeliverOpen(true)}
          canDeliver={canDeliver}
          canSave={canEdit || sectorId === "CODIFICADO"}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setOaMode("simple")}>
              Volver a carga simple
            </Button>
            <p className="text-xs text-[var(--os-text-muted)] self-center">
              Formulario completo · el PDF legal no cambia
            </p>
          </div>
          <OaFormSections
            content={form}
            readOnly={!canEdit}
            codificadoOnly={sectorId === "CODIFICADO"}
            onChange={(next) => {
              const legal = recomputeOaDerived(next);
              updateForm(() => legal);
              setOaSimple(
                initOaSimpleFormFromLegal(legal, {
                  sector:
                    order.assignedSector === "ENVASADO_PREMIUM"
                      ? "ENVASADO_PREMIUM"
                      : order.assignedSector === "ENVASADO_MASIVO"
                        ? "ENVASADO_MASIVO"
                        : "",
                })
              );
            }}
            onAddMaterial={() =>
              updateForm((prev) => {
                if (prev.kind !== "OA") return prev;
                const nro = prev.materials.length + 1;
                return { ...prev, materials: [...prev.materials, emptyOaMaterial(nro)] };
              })
            }
            onRemoveMaterial={(id) =>
              updateForm((prev) => {
                if (prev.kind !== "OA") return prev;
                return renumberOaMaterials({
                  ...prev,
                  materials: prev.materials.filter((m) => m.id !== id),
                });
              })
            }
          />
        </div>
      )}

      <Dialog
        open={formulaReplaceOpen}
        onOpenChange={(open) => {
          setFormulaReplaceOpen(open);
          if (!open) {
            pendingResolvePayloadRef.current = null;
            pendingFormulaIdentityRef.current = null;
            setFormulaStatus("skipped_manual");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reemplazar fórmula</DialogTitle>
            <DialogDescription>
              Ya hay materias primas o procedimiento cargados. ¿Reemplazarlos con la fórmula
              maestra del nuevo cliente/producto?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              data-testid="formula-replace-keep"
              onClick={() => {
                setFormulaReplaceOpen(false);
                pendingResolvePayloadRef.current = null;
                pendingFormulaIdentityRef.current = null;
                setFormulaStatus("skipped_manual");
              }}
            >
              Conservar edición actual
            </Button>
            <Button
              type="button"
              data-testid="formula-replace-confirm"
              onClick={() => {
                const payload = pendingResolvePayloadRef.current;
                const identity = pendingFormulaIdentityRef.current;
                setFormulaReplaceOpen(false);
                if (payload && identity) {
                  applyResolvedFormula(payload, identity);
                }
                pendingResolvePayloadRef.current = null;
                pendingFormulaIdentityRef.current = null;
              }}
            >
              Reemplazar con fórmula maestra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={formulaPromptOpen} onOpenChange={setFormulaPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambio de fórmula</DialogTitle>
            <DialogDescription>
              ¿Este cambio corresponde solamente a esta orden o debe proponerse como una nueva
              versión de la plantilla maestra?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => {
              setFormulaPromptOpen(false);
              setPendingFormulaForm(null);
            }}>
              Cancelar
            </Button>
            <Button type="button" variant="secondary" onClick={applyFormulaOrderOnly} data-testid="formula-order-only">
              Aplicar solamente a esta orden
            </Button>
            <Button type="button" onClick={() => void applyFormulaAndProposeMaster()} data-testid="formula-propose-master">
              Proponer nueva versión maestra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entregar orden</DialogTitle>
            <DialogDescription>
              {missingFields.length > 0
                ? "Esta orden tiene información sin completar. Podés guardarla como borrador o entregarla con campos pendientes."
                : "¿Confirmás que la orden está completa? Se notificará a Calidad y Producción. No modifica la plantilla maestra."}
            </DialogDescription>
          </DialogHeader>
          {missingFields.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-rose-800" data-testid="deliver-missing-fields">
              {missingFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="secondary" onClick={() => setDeliverOpen(false)}>
              {missingFields.length > 0 ? "Volver a editar" : "Cancelar"}
            </Button>
            {missingFields.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                data-testid="deliver-save-draft"
                onClick={() => {
                  setDeliverOpen(false);
                  void saveNow();
                }}
              >
                Guardar como borrador
              </Button>
            )}
            {missingFields.length > 0 ? (
              <Button
                type="button"
                data-testid="deliver-incomplete"
                onClick={() => void onDeliver(true)}
              >
                Entregar con campos pendientes
              </Button>
            ) : (
              <Button type="button" data-testid="deliver-confirm" onClick={() => void onDeliver(false)}>
                Entregar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={meShortageOpen} onOpenChange={setMeShortageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stock ME insuficiente</DialogTitle>
            <DialogDescription>
              No hay stock suficiente para la cantidad utilizada. Podés cancelar o confirmar con
              motivo (no se deja stock negativo en silencio).
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm" data-testid="me-stock-shortages">
            {meShortages.map((s) => (
              <li key={`${s.codigo}-${s.material}`} className="rounded border border-rose-200 bg-rose-50 px-3 py-2">
                <div>
                  <span className="font-medium">{s.codigo}</span> — {s.material}
                </div>
                <div className="text-rose-900">
                  Disponible: {s.stockDisponible} · Solicitado: {s.cantidadSolicitada} · Falta:{" "}
                  {s.diferencia}
                </div>
              </li>
            ))}
          </ul>
          <label className="block space-y-1 text-sm">
            <span>Motivo (obligatorio para confirmar)</span>
            <textarea
              value={meShortageReason}
              onChange={(e) => setMeShortageReason(e.target.value)}
              className="min-h-20 w-full rounded border px-3 py-2"
              data-testid="me-shortage-reason"
            />
          </label>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => setMeShortageOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="me-shortage-confirm"
              disabled={!meShortageReason.trim()}
              onClick={() =>
                void onDeliver(pendingAllowIncomplete, {
                  allowNegativeMeStock: true,
                  negativeMeStockReason: meShortageReason.trim(),
                })
              }
            >
              Entregar con stock insuficiente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={masterOpen} onOpenChange={setMasterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar como maestra</DialogTitle>
            <DialogDescription>
              Los cambios se utilizarán en las próximas órdenes de este producto. Las órdenes
              anteriores no serán modificadas.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span>Motivo de modificación (obligatorio)</span>
            <textarea
              value={masterReason}
              onChange={(e) => setMasterReason(e.target.value)}
              className="min-h-24 w-full rounded border px-3 py-2"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setMasterOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!masterReason.trim()}
              onClick={() => void onMaster()}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver para corrección</DialogTitle>
            <DialogDescription>
              Se conserva la versión entregada y se crea una nueva revisión.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Motivo obligatorio"
            className="min-h-24 w-full rounded border px-3 py-2 text-sm"
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReturnOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!returnReason.trim()}
              onClick={() =>
                void returnOrderApi(session, orderId, returnReason).then((o) => {
                  setOrder(o);
                  setForm(o.formData);
                  versionRef.current = o.version;
                  setReturnOpen(false);
                })
              }
            >
              Devolver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// silence unused type imports used by section components via props
void (0 as unknown as OeContent);
void (0 as unknown as OaContent);

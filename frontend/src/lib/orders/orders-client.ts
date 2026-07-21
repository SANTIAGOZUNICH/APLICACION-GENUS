import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import type {
  CreateOrderInput,
  ListOrdersFilters,
  OrderDocType,
  OperationalOrderRecord,
  OrderTemplateRecord,
  OsNotificationRecord,
  PatchOrderInput,
} from "@/lib/orders/types";

export type OrdersClientSession = {
  email: string;
  sector: string;
};

function actorHeaders(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & {
    error?: string;
    code?: string;
    shortages?: Array<{
      codigo: string;
      material: string;
      materialId: string | null;
      stockDisponible: number;
      cantidadSolicitada: number;
      diferencia: number;
    }>;
  };
  if (!res.ok) {
    const err = new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`
    ) as Error & {
      status?: number;
      code?: string;
      current?: OperationalOrderRecord;
      shortages?: typeof body.shortages;
    };
    err.status = res.status;
    err.code = (body as { code?: string }).code;
    err.current = (body as { current?: OperationalOrderRecord }).current;
    err.shortages = body.shortages;
    throw err;
  }
  return body;
}

export async function fetchOrderTemplates(
  session: OrdersClientSession,
  type?: OrderDocType
): Promise<OrderTemplateRecord[]> {
  const qs = type ? `?type=${type}` : "";
  const res = await fetch(`/api/v1/order-templates${qs}`, {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  const data = await parseJson<{ templates: OrderTemplateRecord[] }>(res);
  return data.templates;
}

/** Catálogo de referencia — funciona sin DATABASE_URL (solo preview). */
export async function fetchBuiltinTemplates(
  type?: OrderDocType
): Promise<OrderTemplateRecord[]> {
  const qs = type ? `?type=${type}` : "";
  const res = await fetch(`/api/v1/order-templates/builtin${qs}`, {
    cache: "no-store",
  });
  const data = await parseJson<{ templates: OrderTemplateRecord[] }>(res);
  return data.templates;
}

export async function fetchAllOrderTemplates(
  session: OrdersClientSession,
  type?: OrderDocType
): Promise<OrderTemplateRecord[]> {
  const params = new URLSearchParams({ all: "1" });
  if (type) params.set("type", type);
  const res = await fetch(`/api/v1/order-templates?${params}`, {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  const data = await parseJson<{ templates: OrderTemplateRecord[] }>(res);
  return data.templates;
}

export async function importSeedTemplatesApi(
  session: OrdersClientSession,
  type?: OrderDocType
): Promise<OrderTemplateRecord[]> {
  const res = await fetch("/api/v1/order-templates", {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({ action: "import_seed", type }),
  });
  const data = await parseJson<{ templates: OrderTemplateRecord[] }>(res);
  return data.templates;
}

export async function createTemplateApi(
  session: OrdersClientSession,
  input: {
    type: OrderDocType;
    productName: string;
    productCode: string;
    brandClient?: string | null;
    changeReason?: string;
    content?: OrderTemplateRecord["content"];
    productId?: string;
    sourceFile?: string | null;
  }
): Promise<OrderTemplateRecord> {
  const res = await fetch("/api/v1/order-templates", {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ template: OrderTemplateRecord }>(res);
  return data.template;
}

export async function createOrderFromScratchApi(
  session: OrdersClientSession,
  input: {
    type: OrderDocType;
    product?: string;
    code?: string;
    client?: string;
    lot?: string;
    assignedSector?: string | null;
    content?: OrderTemplateRecord["content"];
    alsoCreateMaster?: boolean;
    masterChangeReason?: string;
    confirmEmptyMaster?: boolean;
    emptyDraft?: boolean;
  }
): Promise<{
  order: OperationalOrderRecord;
  template: OrderTemplateRecord | null;
}> {
  const res = await fetch("/api/v1/orders", {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({
      ...input,
      fromScratch: true,
      emptyDraft: input.emptyDraft ?? true,
    }),
  });
  return parseJson(res);
}

export async function createEmptyDraftApi(
  session: OrdersClientSession,
  input: {
    type: OrderDocType;
    assignedSector?: string | null;
  }
): Promise<OperationalOrderRecord> {
  const result = await createOrderFromScratchApi(session, {
    type: input.type,
    product: "",
    code: "",
    client: "",
    lot: "",
    assignedSector: input.assignedSector,
    emptyDraft: true,
  });
  return result.order;
}

export async function templateActionApi(
  session: OrdersClientSession,
  id: string,
  action: "duplicate" | "new_version" | "obsolete",
  extra?: Record<string, unknown>
): Promise<OrderTemplateRecord> {
  const res = await fetch(`/api/v1/order-templates/${id}`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await parseJson<{ template: OrderTemplateRecord }>(res);
  return data.template;
}

export async function fetchTemplateHistoryApi(
  session: OrdersClientSession,
  id: string
): Promise<{ template: OrderTemplateRecord; versions: OrderTemplateRecord[] }> {
  const res = await fetch(`/api/v1/order-templates/${id}?history=1`, {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  return parseJson(res);
}

export async function fetchOrders(
  session: OrdersClientSession,
  filters: ListOrdersFilters
): Promise<{
  items: OperationalOrderRecord[];
  total: number;
  pendingCount: number;
  completeCount: number;
  legallyOperational: boolean;
}> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.tab) params.set("tab", filters.tab);
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedSector) params.set("assignedSector", filters.assignedSector);
  if (filters.product) params.set("product", filters.product);
  if (filters.client) params.set("client", filters.client);
  if (filters.year) params.set("year", String(filters.year));
  if (filters.month) params.set("month", String(filters.month));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.emptyDraft) params.set("emptyDraft", "1");
  if (filters.unassigned) params.set("unassigned", "1");
  if (filters.emptyProduct) params.set("emptyProduct", "1");
  if (filters.emptyClient) params.set("emptyClient", "1");
  if (filters.emptyLot) params.set("emptyLot", "1");
  if (filters.createdBy) params.set("createdBy", filters.createdBy);
  const res = await fetch(`/api/v1/orders?${params}`, {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  return parseJson(res);
}

export async function createOrderApi(
  session: OrdersClientSession,
  input: CreateOrderInput
): Promise<OperationalOrderRecord> {
  const res = await fetch("/api/v1/orders", {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function fetchOrder(
  session: OrdersClientSession,
  id: string
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}`, {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function saveOrderProgressApi(
  session: OrdersClientSession,
  id: string,
  input: PatchOrderInput
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}`, {
    method: "PATCH",
    headers: actorHeaders(session),
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function deliverOrderApi(
  session: OrdersClientSession,
  id: string,
  opts?: {
    allowIncomplete?: boolean;
    allowNegativeMeStock?: boolean;
    negativeMeStockReason?: string;
    includeDesechadosMe?: boolean;
  }
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}/deliver`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({
      confirm: true,
      allowIncomplete: Boolean(opts?.allowIncomplete),
      allowNegativeMeStock: Boolean(opts?.allowNegativeMeStock),
      negativeMeStockReason: opts?.negativeMeStockReason,
      includeDesechadosMe: Boolean(opts?.includeDesechadosMe),
    }),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function deleteEmptyDraftApi(
  session: OrdersClientSession,
  id: string
): Promise<{ deleted: boolean; orderNumber: string }> {
  const res = await fetch(`/api/v1/orders/${id}`, {
    method: "DELETE",
    headers: actorHeaders(session),
  });
  return parseJson(res);
}

export async function saveAsMasterApi(
  session: OrdersClientSession,
  id: string,
  changeReason: string
) {
  const res = await fetch(`/api/v1/orders/${id}/save-as-master`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({ changeReason, confirm: true }),
  });
  return parseJson(res);
}

export async function returnOrderApi(
  session: OrdersClientSession,
  id: string,
  reason: string
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}/return`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({ reason }),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function reviewOrderApi(
  session: OrdersClientSession,
  id: string
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}/review`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({}),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function archiveOrderApi(
  session: OrdersClientSession,
  id: string
): Promise<OperationalOrderRecord> {
  const res = await fetch(`/api/v1/orders/${id}/archive`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({}),
  });
  const data = await parseJson<{ order: OperationalOrderRecord }>(res);
  return data.order;
}

export async function decideProposalApi(
  session: OrdersClientSession,
  proposalId: string,
  decision: "APROBADA" | "RECHAZADA",
  decisionReason: string
) {
  const res = await fetch(`/api/v1/order-templates/proposals/${proposalId}/decide`, {
    method: "POST",
    headers: actorHeaders(session),
    body: JSON.stringify({ decision, decisionReason }),
  });
  return parseJson(res);
}

export async function fetchOsNotifications(
  session: OrdersClientSession
): Promise<OsNotificationRecord[]> {
  const res = await fetch("/api/v1/notifications", {
    headers: actorHeaders(session),
    cache: "no-store",
  });
  const data = await parseJson<{ notifications: OsNotificationRecord[] }>(res);
  return data.notifications;
}

export function orderPdfUrl(id: string): string {
  return `/api/v1/orders/${id}/pdf`;
}

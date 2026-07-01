"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormErrorMessage } from "@/components/forms/form-error-message";
import { FormField } from "@/components/forms/form-field";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function FormsSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <DesignSystemSection
      id="formularios"
      title="Formularios y confirmación"
      description="Etiqueta arriba, validación inline, confirmación en lo irreversible."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <DesignSystemPanel>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <FormField
              htmlFor="lote-input"
              label="Número de lote"
              required
              description="Escaneá o ingresá el código del lote."
              error="El lote MP-2024-331 no está liberado."
            >
              <input
                type="text"
                defaultValue="MP-2024-331"
                className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </FormField>
            <FormErrorMessage
              message="No se pudo registrar el consumo."
              resolution="Verificá que el lote esté liberado e intentá de nuevo."
            />
          </form>
        </DesignSystemPanel>
        <DesignSystemPanel>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            ConfirmDialog — antes de acciones irreversibles (cerrar, firmar, despachar).
          </p>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Firmar liberación
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="¿Firmar liberación?"
            description="Esta acción es irreversible. El lote quedará disponible para despacho."
            confirmLabel="Firmar"
            cancelLabel="Cancelar"
            variant="destructive"
            onConfirm={() => undefined}
          />
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}

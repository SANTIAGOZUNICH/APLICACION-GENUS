"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/forms/form-field";
import { buildReviewItems, canAdvanceStep, isLastStep } from "@/lib/actions/action-flow-utils";
import type { UseActionParams } from "@/components/patterns/actions/use-action";
import { useActionFlow } from "@/components/patterns/actions/use-action";

interface ActionFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  params: UseActionParams | null;
}

/**
 * ActionFlowDialog — Action → Flow → Steps → Review → Execute → Result
 * Forms are one step type within the flow.
 */
export function ActionFlowDialog({
  open,
  onOpenChange,
  params,
}: ActionFlowDialogProps) {
  const flow = useActionFlow(open ? params : null);
  const { definition, stepIndex, flowData, updateStepData, advance, back, execute, reset } =
    flow;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset();
      setFieldErrors({});
      setExecuting(false);
    }
    onOpenChange(nextOpen);
  }

  if (!definition || !params) return null;

  const steps = definition.flow.steps;
  const currentStep = steps[stepIndex];
  const reviewItems = buildReviewItems(definition, flowData);

  async function handlePrimary() {
    if (!currentStep) return;

    if (currentStep.type === "form" && !canAdvanceStep(currentStep, flowData)) {
      const errors: Record<string, string> = {};
      for (const field of currentStep.fields) {
        if (field.required && !flowData[currentStep.id]?.[field.id]?.trim()) {
          errors[field.id] = "Este campo es obligatorio.";
        }
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});

    if (isLastStep(steps, stepIndex)) {
      setExecuting(true);
      const result = await execute();
      setExecuting(false);
      if (result?.ok) handleOpenChange(false);
      if (result && !result.ok && result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
      return;
    }

    advance();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{definition.label}</DialogTitle>
          <DialogDescription>{definition.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p
            className="text-[var(--muted-foreground)]"
            style={{ fontSize: "var(--text-caption)" }}
          >
            Paso {stepIndex + 1} de {steps.length}
          </p>

          {currentStep?.type === "form" && (
            <div className="space-y-4">
              <div>
                <h4
                  className="font-medium text-[var(--foreground)]"
                  style={{ fontSize: "var(--text-card-title)" }}
                >
                  {currentStep.title}
                </h4>
                {currentStep.description && (
                  <p
                    className="mt-1 text-[var(--muted-foreground)]"
                    style={{ fontSize: "var(--text-meta)" }}
                  >
                    {currentStep.description}
                  </p>
                )}
              </div>
              {currentStep.fields.map((field) => (
                <FormField
                  key={field.id}
                  htmlFor={`${currentStep.id}-${field.id}`}
                  label={field.label}
                  required={field.required}
                  description={field.description}
                  error={fieldErrors[field.id]}
                >
                  {field.type === "select" ? (
                    <select
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={flowData[currentStep.id]?.[field.id] ?? ""}
                      onChange={(e) =>
                        updateStepData(currentStep.id, field.id, e.target.value)
                      }
                    >
                      <option value="">Seleccionar…</option>
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      className="min-h-20 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      placeholder={field.placeholder}
                      value={flowData[currentStep.id]?.[field.id] ?? ""}
                      onChange={(e) =>
                        updateStepData(currentStep.id, field.id, e.target.value)
                      }
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      placeholder={field.placeholder}
                      value={flowData[currentStep.id]?.[field.id] ?? ""}
                      onChange={(e) =>
                        updateStepData(currentStep.id, field.id, e.target.value)
                      }
                    />
                  )}
                </FormField>
              ))}
            </div>
          )}

          {currentStep?.type === "review" && (
            <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--background)] p-4">
              <h4
                className="font-medium text-[var(--foreground)]"
                style={{ fontSize: "var(--text-card-title)" }}
              >
                {currentStep.title}
              </h4>
              {currentStep.description && (
                <p
                  className="text-[var(--muted-foreground)]"
                  style={{ fontSize: "var(--text-meta)" }}
                >
                  {currentStep.description}
                </p>
              )}
              <dl className="space-y-2">
                {reviewItems.map((item) => (
                  <div key={item.label}>
                    <dt
                      className="text-[var(--muted-foreground)]"
                      style={{ fontSize: "var(--text-caption)" }}
                    >
                      {item.label}
                    </dt>
                    <dd
                      className="font-medium text-[var(--foreground)]"
                      style={{ fontSize: "var(--text-body)" }}
                    >
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {currentStep?.type === "confirm" && (
            <div className="rounded-lg border border-[var(--color-problem)]/20 bg-[var(--badge-problem-bg)] p-4">
              <h4
                className="font-medium text-[var(--foreground)]"
                style={{ fontSize: "var(--text-card-title)" }}
              >
                {currentStep.title}
              </h4>
              <p
                className="mt-2 text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-body)" }}
              >
                {currentStep.description}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {stepIndex > 0 && (
            <Button variant="secondary" onClick={back} disabled={executing}>
              Atrás
            </Button>
          )}
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={
              currentStep?.type === "confirm" ? "destructive" : "primary"
            }
            onClick={handlePrimary}
            disabled={executing}
          >
            {executing
              ? "Procesando…"
              : isLastStep(steps, stepIndex)
                ? currentStep?.type === "confirm"
                  ? currentStep.confirmLabel ?? "Confirmar"
                  : "Ejecutar"
                : "Continuar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

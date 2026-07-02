"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  OctagonAlert,
  Sparkles,
} from "lucide-react";
import {
  genusButtonVariants,
  genusCardList,
  genusColorSwatches,
  genusConceptualComponents,
  genusCreamy,
  genusDesignRules,
  genusFormRules,
  genusMotionPresets,
  genusPanelList,
  genusSpacingScale,
  genusStatusList,
  genusTypographySamples,
} from "@/design-system";
import "@/design-system/genus-tokens.css";

const STATUS_ICONS = {
  pending: Clock,
  inProgress: Loader2,
  blocked: OctagonAlert,
  success: CheckCircle2,
  urgent: Flame,
  alert: AlertCircle,
  creamy: Sparkles,
  work: Briefcase,
} as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="genus-ds-section">
      <h2 className="genus-ds-heading-l mb-2">{title}</h2>
      {description && <p className="genus-ds-body mb-6 text-[var(--genus-text-secondary)]">{description}</p>}
      {children}
    </section>
  );
}

export function GenusDesignSystemGuide() {
  return (
    <div className="genus-ds-root">
      <Section
        id="filosofia"
        title="Filosofía Genus OS"
        description="Claridad, calma, precisión de laboratorio moderno. Nunca caótico ni recargado."
      >
        <div className="rounded-[var(--genus-radius-xl)] border border-[var(--genus-neutral-200)] bg-[var(--genus-surface-card)] p-8 shadow-[var(--genus-shadow-sm)]">
          <p className="genus-ds-heading-m mb-4">Prioridad absoluta</p>
          <p className="genus-ds-heading-xl text-[var(--genus-brand-primary)]">
            Entender qué tengo que hacer.
          </p>
          <p className="mt-4 genus-ds-body text-[var(--genus-text-secondary)]">
            Referencias: Apple · Linear · Notion · Arc · Raycast · Vercel — con identidad Laboratorio Genus.
          </p>
        </div>
      </Section>

      <Section id="colores" title="Colores oficiales" description="Turquesa Genus + petróleo + neutros desaturados.">
        <div className="space-y-8">
          {genusColorSwatches.map(({ group, items }) => (
            <div key={group}>
              <p className="genus-ds-label mb-3">{group}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {items.map((item) => {
                  const hex = "hex" in item ? item.hex : "";
                  const name = "name" in item ? item.name : undefined;
                  return (
                    <div
                      key={`${group}-${name ?? hex}`}
                      className="overflow-hidden rounded-[var(--genus-radius-lg)] border border-[var(--genus-neutral-200)]"
                    >
                      <div className="h-16" style={{ background: hex }} />
                      <div className="bg-[var(--genus-surface-card)] p-3">
                        <p className="font-mono text-xs text-[var(--genus-text-secondary)]">{hex}</p>
                        {name && <p className="mt-1 text-sm font-medium">{name}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="tipografia" title="Tipografía" description="Jerarquía marcada, mucho espacio.">
        <div className="space-y-6 rounded-[var(--genus-radius-xl)] border border-[var(--genus-neutral-200)] bg-[var(--genus-surface-card)] p-8">
          {genusTypographySamples.map(({ role, sample }) => (
            <div key={role} className="border-b border-[var(--genus-neutral-100)] pb-4 last:border-0">
              <p className="genus-ds-label mb-2">{role}</p>
              <p
                className={
                  role === "Heading XL"
                    ? "genus-ds-heading-xl"
                    : role === "Heading L"
                      ? "genus-ds-heading-l"
                      : role === "Heading M"
                        ? "genus-ds-heading-m"
                        : role === "Label"
                          ? "genus-ds-label !text-[var(--genus-text-primary)]"
                          : role === "Caption"
                            ? "genus-ds-caption"
                            : "genus-ds-body"
                }
              >
                {sample}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="espaciado" title="Espaciado" description="Escala única — nada arbitrario.">
        <div className="flex flex-wrap gap-4">
          {genusSpacingScale.map(({ token, px }) => (
            <div
              key={token}
              className="flex flex-col items-center rounded-[var(--genus-radius-md)] border border-[var(--genus-neutral-200)] bg-[var(--genus-surface-card)] px-4 py-3"
            >
              <div
                className="mb-2 bg-[var(--genus-brand-primary)]"
                style={{ width: px, height: 8, maxWidth: 64 }}
              />
              <p className="font-mono text-xs">{token}</p>
              <p className="text-xs text-[var(--genus-text-secondary)]">{px}px</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="botones" title="Botones" description="Primary, secondary, ghost, danger.">
        <div className="flex flex-wrap gap-3">
          <button type="button" className="genus-ds-btn-primary">
            Primary
          </button>
          <button type="button" className="genus-ds-btn-secondary">
            Secondary
          </button>
          <button
            type="button"
            className="genus-ds-btn-secondary border-transparent bg-transparent"
          >
            Ghost
          </button>
          <button
            type="button"
            className="genus-ds-btn-secondary"
            style={{
              background: genusButtonVariants.danger.bg,
              color: genusButtonVariants.danger.color,
              borderColor: genusButtonVariants.danger.border,
            }}
          >
            Danger
          </button>
        </div>
      </Section>

      <Section id="estados" title="Estados operativos">
        <div className="flex flex-wrap gap-3">
          {genusStatusList.map((status) => {
            const iconKey =
              status.icon === "pending"
                ? "pending"
                : status.icon === "inProgress"
                  ? "inProgress"
                  : status.icon === "blocked"
                    ? "blocked"
                    : status.icon === "success"
                      ? "success"
                      : "urgent";
            const Icon = STATUS_ICONS[iconKey];
            return (
              <span
                key={status.id}
                className="genus-ds-badge"
                style={{
                  background: status.bg,
                  color: status.color,
                  border: `1px solid ${status.border}`,
                }}
              >
                <Icon className="size-3.5" />
                {status.label}
              </span>
            );
          })}
        </div>
      </Section>

      <Section id="cards" title="Cards oficiales" description="No crear cards fuera de estos tipos.">
        <div className="grid gap-6 lg:grid-cols-2">
          {genusCardList.map((card) => (
            <div
              key={card.id}
              style={{
                padding: card.padding,
                borderRadius: card.radius,
                boxShadow: card.shadow,
                border: card.border,
                background: card.background,
                minHeight: card.minHeight,
              }}
            >
              <p className="genus-ds-label mb-2">{card.name}</p>
              <p className="genus-ds-body text-sm">{card.purpose}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="paneles" title="Paneles OS Shell">
        <div className="grid gap-4 lg:grid-cols-2">
          {genusPanelList.map((panel) => (
            <div
              key={panel.id}
              className="rounded-[var(--genus-radius-lg)] border border-[var(--genus-neutral-200)] p-5"
              style={{ background: panel.id === "sidebar" ? panel.background : "var(--genus-surface-card)" }}
            >
              <p
                className="font-semibold"
                style={{ color: panel.id === "sidebar" ? "var(--genus-text-inverse)" : undefined }}
              >
                {panel.name}
              </p>
              <ul
                className="mt-3 space-y-1 text-sm"
                style={{ color: panel.id === "sidebar" ? "var(--genus-neutral-400)" : "var(--genus-text-secondary)" }}
              >
                {panel.rules.map((rule) => (
                  <li key={rule}>· {rule}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="creamy" title="Creamy — identidad visual">
        <div
          className="max-w-md rounded-[var(--genus-radius-lg)] p-5"
          style={{
            background: genusCreamy.colors.cardBg,
            border: `1px solid ${genusCreamy.colors.cardBorder}`,
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--genus-brand-primary)]" />
            <p className="genus-ds-label !text-[var(--genus-brand-primary)]">Copiloto · Envasado</p>
          </div>
          <p className="mt-3 text-sm font-medium">Prioridad: THELMA Y LOUISE</p>
          <p className="mt-1 text-sm text-[var(--genus-text-secondary)]">
            Te guío con la OA y los pasos para cerrar el día.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Abrir OA", "Ver insumos", "Marcar avance"].map((s) => (
              <span
                key={s}
                className="rounded-full border border-[var(--genus-brand-primary-muted)] bg-white/80 px-3 py-1 text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <ul className="mt-6 space-y-1 text-sm text-[var(--genus-text-secondary)]">
          {genusCreamy.rules.map((rule) => (
            <li key={rule}>· {rule}</li>
          ))}
        </ul>
      </Section>

      <Section id="motion" title="Motion">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(genusMotionPresets).map(([name, preset]) => (
            <div
              key={name}
              className="rounded-[var(--genus-radius-md)] border border-[var(--genus-neutral-200)] bg-[var(--genus-surface-card)] p-4"
            >
              <p className="font-medium capitalize">{name}</p>
              <p className="mt-1 font-mono text-xs text-[var(--genus-text-secondary)]">
                {preset.duration} · {preset.easing}
              </p>
            </div>
          ))}
          <div className="rounded-[var(--genus-radius-md)] border border-[var(--genus-neutral-200)] p-4">
            <p className="font-medium">Skeleton</p>
            <div className="genus-ds-skeleton mt-3 h-3 w-full" />
            <div className="genus-ds-skeleton mt-2 h-3 w-2/3" />
          </div>
        </div>
      </Section>

      <Section id="conceptos" title="Componentes conceptuales" description="Reglas visuales — no implementación final.">
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(genusConceptualComponents).map(([name, rule]) => (
            <div
              key={name}
              className="rounded-[var(--genus-radius-md)] border border-[var(--genus-neutral-200)] bg-[var(--genus-surface-card)] px-4 py-3"
            >
              <p className="genus-ds-label mb-1">{name}</p>
              <p className="text-sm text-[var(--genus-text-secondary)]">{rule}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 genus-ds-caption">Formularios: {genusFormRules.join(" · ")}</p>
      </Section>

      <Section id="reglas" title="Reglas inviolables">
        <ul className="space-y-2 rounded-[var(--genus-radius-xl)] border border-[var(--genus-brand-primary-muted)] bg-[var(--genus-brand-primary-soft)] p-6">
          {genusDesignRules.map((rule) => (
            <li key={rule} className="flex gap-2 text-sm">
              <span className="text-[var(--genus-brand-primary)]">—</span>
              {rule}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

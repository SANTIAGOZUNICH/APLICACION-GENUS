import { Alert } from "@/components/ui/alert";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function AlertsSection() {
  return (
    <DesignSystemSection
      id="alertas"
      title="Alert"
      description="Inline en contexto. Popup solo si es bloqueante."
    >
      <div className="space-y-4">
        <DesignSystemPanel className="p-0 border-0 bg-transparent space-y-4">
          <Alert variant="info" title="Información">
            El lote está en cuarentena hasta completar el análisis microbiológico.
          </Alert>
          <Alert variant="attention" title="Atención" action={{ label: "Ver detalle" }}>
            El compromiso de despacho vence en 2 días.
          </Alert>
          <Alert variant="problem" title="Problema">
            Consumo fuera de tolerancia detectado en el renglón 3.
          </Alert>
          <Alert variant="ok" title="OK">
            Análisis microbiológico aprobado. Listo para disposición.
          </Alert>
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}

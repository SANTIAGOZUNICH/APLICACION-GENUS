import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function CardsSection() {
  return (
    <DesignSystemSection
      id="cards"
      title="Card (base)"
      description="Unidad de información: cabecera · cuerpo · pie. Las cards GMP heredan de EntityCard."
    >
      <DesignSystemPanel className="max-w-md">
        <Card padding="none" variant="default" className="border-0 shadow-none">
          <CardHeader className="p-0 pb-3">
            <CardTitle>Card base</CardTitle>
            <CardDescription>
              Layout genérico para secciones de Object Pages y contenedores.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              Cuerpo con 1–3 datos clave. Una sola idea por card.
            </p>
          </CardContent>
          <CardFooter className="p-0 pt-0">
            <Button variant="primary" size="sm">
              Acción primaria
            </Button>
          </CardFooter>
        </Card>
      </DesignSystemPanel>
    </DesignSystemSection>
  );
}

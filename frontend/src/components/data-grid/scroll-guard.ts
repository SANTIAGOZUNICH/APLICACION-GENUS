/**
 * Guardia de scroll de las planillas.
 *
 * La planilla solo puede moverse cuando el USUARIO la mueve (rueda, dedo, barras, teclas de navegación, clic en una
 * celda). Mientras llegan datos del servidor (guardado automático, recarga, filas nuevas) el motor de la grilla
 * puede volver a «mostrar la celda activa/seleccionada» y arrastrar la hoja a otro lado: ese desplazamiento NO lo pidió
 * nadie y se revierte al instante a la última posición que el usuario eligió. Fuera de esas ventanas no interviene
 * (los desplazamientos programáticos legítimos —buscar, ir a la fila— siguen funcionando).
 */

export interface ScrollGuardScroller {
  scrollTop: number;
  scrollLeft: number;
  addEventListener(type: "scroll", fn: () => void, opts?: AddEventListenerOptions): void;
  removeEventListener(type: "scroll", fn: () => void): void;
}
export interface ScrollGuardInputTarget {
  addEventListener(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean): void;
}

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Tab", "Enter"]);
/** Tiempo durante el cual un gesto del usuario «justifica» un desplazamiento (el motor reacciona en el mismo tick). */
export const USER_INTENT_MS = 350;

export class ScrollGuard {
  private lastX: number;
  private lastY: number;
  private userUntil = 0;
  private lockUntil = 0;
  private restoring = false;
  private disposed = false;
  private readonly onScroll = () => this.handleScroll();
  private readonly onUser = (e: Event) => {
    if (e.type === "keydown") {
      const k = e as KeyboardEvent;
      if (!(NAV_KEYS.has(k.key) || k.ctrlKey || k.metaKey)) return; // escribir texto no justifica mover la hoja
    }
    if (e.type === "pointermove") {
      const p = e as PointerEvent;
      if (!(p.buttons > 0 || p.pointerType === "touch")) return;
    }
    this.userUntil = this.now() + USER_INTENT_MS;
  };
  private static readonly USER_EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown", "pointermove", "keydown"] as const;

  constructor(
    private readonly el: ScrollGuardScroller,
    private readonly input: ScrollGuardInputTarget,
    private readonly now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
  ) {
    this.lastX = el.scrollLeft;
    this.lastY = el.scrollTop;
    el.addEventListener("scroll", this.onScroll, { passive: true });
    for (const t of ScrollGuard.USER_EVENTS) input.addEventListener(t, this.onUser, { capture: true, passive: true });
  }

  /** Abre una ventana (ms) en la que un desplazamiento sin gesto del usuario se revierte. */
  lock(ms: number) {
    this.lockUntil = Math.max(this.lockUntil, this.now() + ms);
  }

  /** Marca un gesto del usuario (p. ej. un botón que lleva a una fila a propósito). */
  allowUserScroll(ms = USER_INTENT_MS) {
    this.userUntil = Math.max(this.userUntil, this.now() + ms);
  }

  /** Última posición elegida por el usuario. */
  position() {
    return { left: this.lastX, top: this.lastY };
  }

  private handleScroll() {
    if (this.disposed) return;
    if (this.restoring) {
      this.restoring = false;
      return;
    }
    const t = this.now();
    if (t < this.userUntil || t >= this.lockUntil) {
      this.lastX = this.el.scrollLeft;
      this.lastY = this.el.scrollTop;
      return;
    }
    // Desplazamiento que nadie pidió, durante una actualización de datos: se vuelve a donde estaba el usuario.
    if (this.el.scrollTop !== this.lastY || this.el.scrollLeft !== this.lastX) {
      this.restoring = true;
      this.el.scrollTop = this.lastY;
      this.el.scrollLeft = this.lastX;
      if (this.el.scrollTop === this.lastY && this.el.scrollLeft === this.lastX) {
        // el navegador puede haber ajustado (límite de la hoja): se acepta lo que quedó
        this.lastX = this.el.scrollLeft;
        this.lastY = this.el.scrollTop;
      }
    }
  }

  destroy() {
    this.disposed = true;
    this.el.removeEventListener("scroll", this.onScroll);
    for (const t of ScrollGuard.USER_EVENTS) this.input.removeEventListener(t, this.onUser, { capture: true });
  }
}

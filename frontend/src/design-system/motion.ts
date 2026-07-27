/** Genus OS — INDUSTRIAL GLASS motion. Respetar prefers-reduced-motion en CSS. */

export const genusMotion = {
  duration: {
    instant: "0ms",
    fast: "120ms",
    hover: "140ms",
    normal: "180ms",
    panel: "220ms",
    slow: "280ms",
  },
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    out: "cubic-bezier(0.16, 1, 0.3, 1)",
    enter: "cubic-bezier(0, 0, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
  reducedMotion: "Respetar @media (prefers-reduced-motion: reduce) — sin animaciones infinitas ni transform.",
} as const;

export const genusMotionPresets = {
  hover: {
    property: "color, background-color, border-color, box-shadow, opacity, transform",
    duration: genusMotion.duration.hover,
    easing: genusMotion.easing.default,
  },
  expand: {
    property: "height, opacity, transform",
    duration: genusMotion.duration.normal,
    easing: genusMotion.easing.enter,
  },
  drawer: {
    property: "transform",
    duration: genusMotion.duration.panel,
    easing: genusMotion.easing.out,
  },
  modal: {
    property: "opacity, transform",
    duration: genusMotion.duration.panel,
    easing: genusMotion.easing.out,
  },
  loading: {
    property: "opacity",
    duration: genusMotion.duration.normal,
    easing: genusMotion.easing.default,
  },
  skeleton: {
    property: "background-position",
    duration: "1.4s",
    easing: "linear",
  },
} as const;

export const genusTransition = (preset: keyof typeof genusMotionPresets) => {
  const p = genusMotionPresets[preset];
  return `${p.property} ${p.duration} ${p.easing}`;
};

/** Genus OS — motion sutil. Nada exagerado. */

export const genusMotion = {
  duration: {
    instant: "0ms",
    fast: "120ms",
    normal: "200ms",
    slow: "320ms",
  },
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    enter: "cubic-bezier(0, 0, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
    spring: "cubic-bezier(0.34, 1.2, 0.64, 1)",
  },
} as const;

export const genusMotionPresets = {
  hover: {
    property: "color, background-color, border-color, box-shadow, opacity",
    duration: genusMotion.duration.fast,
    easing: genusMotion.easing.default,
  },
  expand: {
    property: "height, opacity, transform",
    duration: genusMotion.duration.normal,
    easing: genusMotion.easing.enter,
  },
  drawer: {
    property: "transform",
    duration: genusMotion.duration.slow,
    easing: genusMotion.easing.enter,
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

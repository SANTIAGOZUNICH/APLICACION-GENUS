/** Marca Genus OS — logotipo vectorial para pantalla de ingreso. */
export function GenusOsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Genus OS"
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="currentColor" fillOpacity="0.12" />
      <path
        d="M14 32V16h7.2c4.2 0 6.8 2.4 6.8 6.1 0 3.4-2.2 5.6-5.7 5.9L28 32h-4.2l-4.8-6.8H18.2V32H14zm4.2-10.2h2.8c1.8 0 2.8-.9 2.8-2.4s-1-2.3-2.8-2.3h-2.8v4.7zM30.5 32l6.8-16h4.7l-6.8 16h-4.7z"
        fill="currentColor"
      />
      <circle cx="38" cy="14" r="3" fill="currentColor" fillOpacity="0.85" />
    </svg>
  );
}

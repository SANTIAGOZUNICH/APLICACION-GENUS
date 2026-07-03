export interface OsSignInIdentityPreview {
  displayName?: string;
  jobTitle?: string;
  sectorLabel?: string;
  roleLabel?: string;
  company?: string;
  avatarUrl?: string;
}

export interface OsSignInCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface OsSignInScreenProps {
  onSubmit?: (credentials: OsSignInCredentials) => void | Promise<void>;
  /** Simula secuencia bootstrap al enviar (solo UI preview en /login). */
  simulateBootstrapOnSubmit?: boolean;
  isSubmitting?: boolean;
  formError?: string | null;
  identityPreview?: OsSignInIdentityPreview | null;
}

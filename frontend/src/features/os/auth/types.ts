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
  /** Access Preview: validación mock + bootstrap + redirect por sector. */
  accessPreview?: boolean;
  /** @deprecated Usar accessPreview — bootstrap simulado sin validación. */
  simulateBootstrapOnSubmit?: boolean;
  isSubmitting?: boolean;
  formError?: string | null;
  identityPreview?: OsSignInIdentityPreview | null;
}

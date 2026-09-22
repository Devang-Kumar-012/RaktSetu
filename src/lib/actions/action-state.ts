/** Shared state shape for profile server actions used with useActionState. */
export interface ProfileActionState {
  ok: boolean;
  error: string | null;
  /** Set when the save succeeded — used to show a confirmation. */
  success?: string;
}

export const initialProfileActionState: ProfileActionState = {
  ok: false,
  error: null,
};

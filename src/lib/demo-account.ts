/**
 * The one documented demo administrator.
 *
 * The admin area needs an admin to exist, and public registration deliberately
 * cannot create one, so the prototype ships a single fixed account instead of
 * hiding the problem. The credential is not a secret — it is printed on the
 * login page on purpose, because an unreachable admin dashboard would be worse
 * than an honestly-labelled demo login.
 *
 * It lives in its own dependency-free module so both storage engines seed the
 * SAME account: the server database (`src/lib/server/db.ts`) and the legacy
 * browser store (`src/lib/local/store.ts`). Two hard-coded copies of a
 * credential is how a demo login silently stops working.
 */
export const DEMO_ADMIN_EMAIL = "admin@raktsetu.demo";
export const DEMO_ADMIN_PASSWORD = "raktsetu-demo";

/** Display name for the seeded demo administrator. */
export const DEMO_ADMIN_NAME = "RaktSetu Demo Admin";

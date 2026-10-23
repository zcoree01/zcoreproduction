// Where each role lands after sign-in. Operators work on the shop floor (mobile
// UI); every other role, including custom roles, uses the management app.
export const FLOOR_HOME = "/floor";
export const APP_HOME = "/dashboard";

export function canUseManagementApp(roleKey: string): boolean {
  return roleKey !== "operator";
}

export function homePathFor(roleKey: string): string {
  return canUseManagementApp(roleKey) ? APP_HOME : FLOOR_HOME;
}

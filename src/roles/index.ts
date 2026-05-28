export const roles = ["ADMIN", "CASHIER", "WAITER", "KITCHEN"] as const;

export type Role = (typeof roles)[number];

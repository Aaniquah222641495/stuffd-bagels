// Talking to the Orders Durable Object. No Cloudflare imports here (types only), so Node tests can use it.
import type { OrdersService } from "./orders-core";

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/** The methods of OrdersService as the Durable Object exposes them (every call is async over RPC). */
export type OrdersRpc = Async<Pick<OrdersService, "lookup" | "begin" | "attach" | "drop" | "markPaid" | "status" | "attention" | "cancelInfo" | "beginCancel" | "finishCancel">>;

export interface OrdersEnv {
  ORDERS?: DurableObjectNamespace;
}

/** The one Orders instance. Throws if the binding is missing: callers fail closed (503). */
export function orders(env: OrdersEnv): OrdersRpc {
  if (!env.ORDERS) throw new Error("orders not configured");
  return env.ORDERS.get(env.ORDERS.idFromName("orders")) as unknown as OrdersRpc;
}

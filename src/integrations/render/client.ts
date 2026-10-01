import { authRequest, currentUserRequest, dbRequest, rpcRequest, sessionUserRequest } from "./server.functions";

const STORAGE_KEY = "spa-intelligence.session";
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type Listener = (event: AuthEvent, session: { access_token: string } | null) => void;
const listeners = new Set<Listener>();

function token() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setToken(value: string | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* browser storage unavailable */
  }
}

function emit(event: AuthEvent) {
  const access_token = token();
  const session = access_token ? { access_token } : null;
  for (const listener of listeners) listener(event, session);
}

function err(error: unknown) {
  const e = error as { message?: string; code?: string; details?: string };
  return {
    message: e?.message ?? String(error),
    ...(e?.code ? { code: e.code } : {}),
    ...(e?.details ? { details: e.details } : {}),
  };
}

type Filter = {
  op: "eq" | "ilike" | "lt" | "gte" | "lte" | "in" | "not";
  column: string;
  value: unknown;
  comparator?: "in" | "is";
};

class QueryBuilder implements PromiseLike<any> {
  private request: any;

  constructor(table: string) {
    this.request = {
      table,
      action: "select",
      filters: [] as Filter[],
      orders: [] as { column: string; ascending: boolean; nullsFirst?: boolean }[],
      countExact: false,
      head: false,
      returning: false,
    };
  }

  select(_columns = "*", options?: { count?: "exact"; head?: boolean }) {
    if (this.request.action !== "select") this.request.returning = true;
    this.request.countExact = this.request.countExact || options?.count === "exact";
    this.request.head = options?.head === true;
    return this;
  }

  insert(payload: unknown) {
    this.request.action = "insert";
    this.request.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.request.action = "update";
    this.request.payload = payload;
    return this;
  }

  delete(options?: { count?: "exact" }) {
    this.request.action = "delete";
    this.request.countExact = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown) {
    this.request.filters.push({ op: "eq", column, value });
    return this;
  }

  ilike(column: string, value: string) {
    this.request.filters.push({ op: "ilike", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.request.filters.push({ op: "lt", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.request.filters.push({ op: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.request.filters.push({ op: "lte", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.request.filters.push({ op: "in", column, value });
    return this;
  }

  not(column: string, comparator: "in" | "is", value: unknown) {
    this.request.filters.push({ op: "not", column, comparator, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.request.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(value: number) {
    this.request.limit = value;
    return this;
  }

  range(from: number, to: number) {
    this.request.range = [from, to];
    return this;
  }

  single() {
    this.request.mode = "single";
    if (this.request.action !== "select") this.request.returning = true;
    return this;
  }

  maybeSingle() {
    this.request.mode = "maybeSingle";
    return this;
  }

  private async execute() {
    try {
      return await dbRequest({ data: this.request });
    } catch (error) {
      return { data: null, error: err(error), count: null };
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export const renderDb = {
  auth: {
    async signUp({
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: { data?: { full_name?: string } };
    }) {
      try {
        const data = await authRequest({
          data: { action: "signup", email, password, fullName: options?.data?.full_name ?? "" },
        });
        return { data, error: null };
      } catch (error) {
        return { data: null, error: err(error) };
      }
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      try {
        const data = await authRequest({ data: { action: "signin", email, password } });
        if (!("access_token" in data) || typeof data.access_token !== "string" || !("user" in data)) throw new Error("Sign-in did not return a session.");
        setToken(data.access_token);
        emit("SIGNED_IN");
        return { data: { user: data.user, session: { access_token: data.access_token } }, error: null };
      } catch (error) {
        return { data: null, error: err(error) };
      }
    },

    async signOut() {
      try {
        await authRequest({ data: { action: "signout" } });
      } catch {
        /* local sign-out still proceeds */
      }
      setToken(null);
      emit("SIGNED_OUT");
      return { error: null };
    },

    async getUser() {
      const access_token = token();

      if (access_token) {
        try {
          const data = await sessionUserRequest({ data: { token: access_token } });
          return { data, error: null };
        } catch {
          // A stale/expired local token must not turn a valid cookie-backed session
          // into a one-navigation error. Clear it, then fall through to the secure
          // HttpOnly cookie in the same request cycle.
          setToken(null);
        }
      }

      try {
        const data = await currentUserRequest();
        return { data, error: null };
      } catch (error) {
        return { data: { user: null }, error: err(error) };
      }
    },

    async getSession() {
      const access_token = token();
      return { data: { session: access_token ? { access_token } : null }, error: null };
    },

    onAuthStateChange(listener: Listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => { listeners.delete(listener); } } } };
    },
  },

  from(table: string) {
    return new QueryBuilder(table);
  },

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    try {
      return await rpcRequest({ data: { fn, args } });
    } catch (error) {
      return { data: null, error: err(error) };
    }
  },
};

import { env } from 'cloudflare:test';

// Returns an env whose DB runs `hook` exactly once, right before the first statement whose SQL
// matches `pattern` is executed (via run/first/all, or as part of a batch). This simulates a
// competing request landing between an endpoint's status pre-check (SELECT) and its write.
export function envWithHookBefore(pattern, hook) {
  const raw = new WeakMap();
  let fired = false;
  const fire = async () => {
    fired = true;
    await hook();
  };
  const wrap = (stmt, sql) => {
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === 'bind') return (...args) => wrap(target.bind(...args), sql);
        if (['run', 'first', 'all', 'raw'].includes(prop) && !fired && pattern.test(sql)) {
          return async (...args) => {
            await fire();
            return target[prop](...args);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    raw.set(proxy, { stmt, sql });
    return proxy;
  };
  const DB = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === 'prepare') return (sql) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async (statements) => {
          const unwrapped = statements.map((s) => raw.get(s) || { stmt: s, sql: '' });
          if (!fired && unwrapped.some((u) => pattern.test(u.sql))) await fire();
          return target.batch(unwrapped.map((u) => u.stmt));
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...env, DB };
}

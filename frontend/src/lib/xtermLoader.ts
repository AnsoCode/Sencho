/**
 * Lazy-loaded xterm. The terminal is only mounted by surfaces the user
 * explicitly opens (TerminalComponent, BashExecModal, HostConsole), but
 * the eager top-level imports used to pull the ~660 KB @xterm chunk plus
 * xterm.css into every cold app start. Defer the chunk until the first
 * terminal mount; the loader caches the imported modules so subsequent
 * mounts hit a warm cache.
 *
 * All four addons live in the same `xterm` manual chunk (see
 * vite.config.ts), so loading the namespace is the same network cost
 * whether one or four classes are needed downstream.
 */

export type Terminal = InstanceType<typeof import('@xterm/xterm')['Terminal']>;
export type FitAddon = InstanceType<typeof import('@xterm/addon-fit')['FitAddon']>;
export type SearchAddon = InstanceType<typeof import('@xterm/addon-search')['SearchAddon']>;
export type SerializeAddon = InstanceType<typeof import('@xterm/addon-serialize')['SerializeAddon']>;

export interface XtermModules {
  Terminal: typeof import('@xterm/xterm')['Terminal'];
  FitAddon: typeof import('@xterm/addon-fit')['FitAddon'];
  SearchAddon: typeof import('@xterm/addon-search')['SearchAddon'];
  SerializeAddon: typeof import('@xterm/addon-serialize')['SerializeAddon'];
}

let cachedPromise: Promise<XtermModules> | null = null;

export function loadXtermModules(): Promise<XtermModules> {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const [xtermMod, fitMod, searchMod, serializeMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
        import('@xterm/addon-serialize'),
        import('@xterm/xterm/css/xterm.css'),
      ]);
      return {
        Terminal: xtermMod.Terminal,
        FitAddon: fitMod.FitAddon,
        SearchAddon: searchMod.SearchAddon,
        SerializeAddon: serializeMod.SerializeAddon,
      };
    })().catch((err) => {
      // On a failed chunk fetch (transient network blip), drop the cached
      // promise so the next terminal mount retries the load instead of
      // permanently rethrowing.
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

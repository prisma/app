/**
 * Local-dev spec § 6 `watch.ts`: watches each assembled bundle's declared
 * `watch` paths (a directory watched recursively, a file watched plainly),
 * debounced 300 ms and coalesced across every service into one callback —
 * one edit across several files/services still fires exactly one rebuild.
 *
 * `Bundle` on this branch does not yet declare an optional `watch` field
 * (spec § 3 — landing in the S2 slice, a sibling of this one; see
 * `.drive/projects/local-dev/spec.md`'s Open Questions). This module reads
 * it defensively through a locally-declared structural extension so it is
 * fully wired the moment a bundle actually carries one; today every bundle
 * takes the pinned "not watched" fallback.
 */
import * as fs from 'node:fs';
import type { Bundle } from '@internal/core/deploy';
import { blindCast } from '@internal/foundation/casts';

const DEBOUNCE_MS = 300;

/** The optional core field this branch's `Bundle` doesn't declare yet — see this module's doc comment. */
type WatchableBundle = Bundle & { readonly watch?: readonly string[] };

export interface WatchTarget {
  readonly address: string;
  readonly paths: readonly string[];
}

/** Bundles → watch targets, plus the addresses with nothing watchable (the pinned one-line startup note). */
export function watchTargetsFrom(bundles: Readonly<Record<string, Bundle>>): {
  readonly targets: readonly WatchTarget[];
  readonly unwatchable: readonly string[];
} {
  const targets: WatchTarget[] = [];
  const unwatchable: string[] = [];
  for (const [address, bundle] of Object.entries(bundles)) {
    const watchable = blindCast<
      WatchableBundle,
      "core's Bundle doesn't declare `watch` on this branch yet (spec § 3, S2 slice); reading it defensively is safe — an absent field is exactly the pinned 'not watched' fallback this code already handles"
    >(bundle);
    const paths = watchable.watch;
    if (paths === undefined || paths.length === 0) {
      unwatchable.push(address);
      continue;
    }
    targets.push({ address, paths });
  }
  return { targets, unwatchable };
}

/**
 * Watches every target's paths, debounced 300 ms and coalesced across every
 * service, invoking `onChange` once per burst. Returns a stop function.
 * Silently skips a path that no longer exists on disk (nothing to watch).
 */
export function startWatch(targets: readonly WatchTarget[], onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: fs.FSWatcher[] = [];

  const trigger = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, DEBOUNCE_MS);
  };

  for (const target of targets) {
    for (const watchPath of target.paths) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(watchPath);
      } catch {
        continue;
      }
      const watcher = fs.watch(watchPath, { recursive: stat.isDirectory() }, () => trigger());
      watchers.push(watcher);
    }
  }

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

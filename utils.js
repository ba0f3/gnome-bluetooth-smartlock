
const GLib = imports.gi.GLib;

function spawn(command, callback) {
  let [status, pid] = GLib.spawn_async(
    null,
    ['/usr/bin/env', 'bash', '-c', command],
    null,
    GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
    null
  );

  GLib.child_watch_add(
    GLib.PRIORITY_DEFAULT, pid,
    (_pid, _status) => {
      try {
        if (callback) {
          callback(_pid, _status);
        }
      } finally {
        GLib.spawn_close_pid(_pid);
      }
    });
}

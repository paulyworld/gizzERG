# roguERGlike concert MVP

Browser-based ERG controller for a YouTube concert ride.

This MVP keeps trainer I/O in `roguerglike-sidecar` and uses YouTube playback
time as the workout clock. The browser reads a pre-authored rolling section map,
computes target watts from rider FTP, and sends `set_target_power` commands to
the sidecar WebSocket.

## Run

Start the sidecar in mock mode with trainer control enabled:

```powershell
cd C:\dev\roguERGlike\repos\sidecar
$env:PYTHONPATH="src"
python -m roguerglike_sidecar.cli --mode mock --allow-trainer-control
```

Serve this folder:

```powershell
cd C:\dev\roguERGlike\repos\concert-mvp
python -m http.server 8430
```

Open:

```text
http://localhost:8430
```

## Behavior

- YouTube IFrame API owns playback, pause, resume, and seek.
- `src/erg-controller.js` owns target lookup, ramp smoothing, clamping, and
  target update cadence.
- `src/concert-profile.js` contains the manually authored rolling map for
  `bnnIdWzGSYI`.
- Paused video stops target writes.
- Seeking recalculates the target from the new video time immediately.
- Sidecar remains the only trainer I/O layer.

## Tests

```powershell
node --test tests\erg-controller.test.mjs
```

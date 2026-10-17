# Helipod / Kubernetes readiness runbook

## Known symptom

The image builds and Uvicorn reports that it is listening on `0.0.0.0:8000`,
but Helipod remains at `0/1 ready` and the deployment health worker times out
after ten minutes. The public route may return `503 no available server` even
though the application itself is healthy.

## Confirm before changing anything

1. Check the service port is `8000` and the process listens on
   `0.0.0.0:8000`.
2. From the running pod, verify both addresses:

   ```sh
   python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status)"
   python -c "import socket,urllib.request; ip=socket.gethostbyname(socket.gethostname()); print(urllib.request.urlopen('http://'+ip+':8000/health', timeout=3).status)"
   ```

3. Both requests should return `200`. If they do, the application is reachable
   inside the pod and the remaining problem is Helipod/Kubernetes readiness,
   not FastAPI or MongoDB.
4. Inspect app logs. If no Kubernetes probe request reaches `/health`, the
   failure is outside the application.

## Workaround verified on Dianastuff

1. Do not define a Docker `HEALTHCHECK`; let Helipod own readiness.
2. In Helipod **Settings -> Build & Run**, clear the Health check path, save,
   and start a fresh deployment. The field may still show `/health` as grey
   placeholder text; the saved value must be empty.
3. Wait for the new revision to become `Running` and serve live traffic.
4. Verify from outside the cluster:

   ```text
   GET /health       -> 200 {"status":"ok"}
   GET /ready        -> 200
   GET /api/products -> 200
   ```

This combination resolved the Dianastuff staging service
`github-5xkvtuh.helipod.app` on 2026-10-17. Do not use `/ready` as the
Kubernetes readiness probe because it also depends on MongoDB.

## Rollback and follow-up

- Apply this workaround to staging first; do not change the production service
  until the same external checks pass.
- If Helipod fixes its probe handling, set the path back to `/health`, redeploy
  staging, and confirm the three external checks before using it elsewhere.
- A pod restart is not a substitute for a new deployment after changing Build
  & Run settings.
- Keep `STORAGE_DIR=/app/data` mounted to the persistent volume; otherwise
  uploaded images disappear when the pod is replaced.

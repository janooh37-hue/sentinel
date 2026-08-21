---
name: "sync-api-types"
description: "Regenerate and validate the frontend TypeScript API contract from FastAPI after the user explicitly asks or changes backend routes or schemas."
---

# /sync-api-types — regenerate frontend API types from the backend schema

The frontend is typed against the backend via generated types. The chain is:

  backend FastAPI app  →  `backend/openapi.json`  →  `frontend/src/lib/api.types.ts`

`mng build` / `mng deploy` deliberately use the **committed** `api.types.ts` and
do NOT regenerate — so after any backend schema change you must run this to
refresh the types, then commit the result.

## Steps

### 1. Dump the OpenAPI schema from the backend
Uses the project venv and the app factory (no need to hit the running service):
```
venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
```
Expect output like `Wrote ...\backend\openapi.json (N paths)`. If the import
fails, the backend has a load-time error — fix that first; the schema can't be
generated from a broken app.

### 2. Regenerate the TypeScript types
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
```
(`gen:api` = `openapi-typescript ../backend/openapi.json -o ./src/lib/api.types.ts`.)

### 3. Typecheck the frontend against the fresh types
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm exec tsc -b --noEmit"
```
New type errors here are the *point* — they show exactly where frontend code no
longer matches the backend contract. Report them; fix call sites as needed.

### 4. Review & commit
```
git --no-pager diff --stat backend/openapi.json frontend/src/lib/api.types.ts
```
Commit both `backend/openapi.json` and `frontend/src/lib/api.types.ts` together
so the committed types match the committed schema. Then deploy via `/deploy`.

## Notes
- `scripts\build.ps1` bundles this regen into a full build; use it when you want
  build + type refresh in one go. This skill is the lightweight "just resync the
  types" path.
- If `pnpm` or `node_modules` is missing, run `pnpm install` in `frontend/` first.


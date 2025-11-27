docker run --rm -ti \
  -v "$PWD:/project" \
  -w /project \
  -e SNAPCRAFT_BUILD_ENVIRONMENT=host \
  -e SNAP_DESTRUCTIVE_MODE=true \
  electronuserland/builder \
  bash -lc "rm -rf node_modules && npm install && npm run dist"

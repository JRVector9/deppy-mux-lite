# Release Notes

## deppy-lite Web Connect Runtime Split

- deppy-lite release/download links and optional runtime assets use the fork origin, `https://github.com/JRVector9/deppy-mux.git`, not upstream `manaflow-ai/cmux`.
- `deppy-lite-arm64`: The default lite bundle no longer includes the Web Connect runtime. The arm64 Release build was verified end-to-end after the split.
- `deppy-lite-universal`: The code and build-script split is in place, but the universal Release build has not been run end-to-end after this change.
- `scripts/build-deppy-lite-universal-release.sh` defaults to no bundled Web Connect runtime.
- Set `DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME=1` to opt in to bundling the Web Connect runtime.
- Without that opt-in, the script removes `Contents/Resources/web-connect` from the lite app bundle and fails if the runtime unexpectedly remains.
- The default Install Runtime URL is `https://github.com/JRVector9/deppy-mux/releases/latest/download/deppy-web-connect-runtime-<arch>.zip`.

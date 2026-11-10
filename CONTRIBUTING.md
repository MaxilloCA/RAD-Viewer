# Contributing

This snapshot is being prepared for public review. Use a focused branch, describe the behavior being changed, and include a small synthetic reproduction. Run `npm test`, `npm run build` and `cargo test --workspace --locked` for relevant changes. Native printing and platform-specific behavior require separate device testing; report those checks honestly.

Never add patient-derived fixtures, screenshots, real network paths, secrets, generated build folders or binary releases. Add deterministic synthetic fixtures when testing decoders. Explain processing changes and their effect on pixel values; passing UI tests does not validate diagnostic performance. Contributions should be compatible with the MIT License.

# Security

## Security model

LaraScura treats every opened repository as potentially hostile until VS Code Workspace Trust is granted.

The extension performs static reads under `app/` and `routes/`. It does not execute workspace code and does not invoke project binaries.

The architecture Webview has:

- `default-src 'none'`;
- nonce-restricted inline styles and scripts;
- no remote resources;
- no access to workspace or extension files through Webview resource roots.

Messages received from the Webview contain only node or edge identifiers. The extension resolves those identifiers against the in-memory graph and verifies that the resulting source path remains inside the selected Laravel root.

## Data handling

Graph data remains in extension-host memory. LaraScura does not transmit telemetry, source, filenames, package metadata, or usage data.

## Reporting

Do not publish a suspected vulnerability before a private fix is available. Until a public security contact is configured, open a GitHub issue containing no exploit details and request a private reporting channel.

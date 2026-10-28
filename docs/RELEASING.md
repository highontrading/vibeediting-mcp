# Releasing

Never publish without the owner's OK.

## One-time setup

1. Create the free npm organization **`vibeediting`** at https://www.npmjs.com/org/create (public packages are free).
2. First publish by hand (trusted publishing cannot create a new package):

   ```bash
   npm login
   npm run check
   npm publish --access public
   ```

3. On npmjs.com, open the package settings, "Trusted publishing", and add GitHub Actions: repository `highontrading/vibeediting-mcp`, workflow `release.yml`, environment `npm`.
4. In GitHub, create the environment `npm` (Settings, Environments) and add yourself as a required reviewer.

## Every release

1. Update the version in all four places (a test checks they match):
   - `package.json` `version`
   - `plugin/.claude-plugin/plugin.json` `version`
   - `plugin/.mcp.json` (the pinned `@vibeediting/mcp@X.Y.Z`)
   - `server.json` (`version` and `packages[0].version`)
2. Add the changes to `CHANGELOG.md`.
3. Run `npm install` (updates the lockfile), `npm run check` and `npm run docs:tools`.
4. Commit, push, wait for CI to be green on macOS, Windows and Ubuntu.
5. GitHub, Actions, "Release to npm", Run workflow. First with "dry run" on, then off.
6. Optional: publish `server.json` to the MCP registry with `mcp-publisher login github` and `mcp-publisher publish`.

## Anthropic directory

Local servers can only be listed inside a plugin. Submit the `plugin/` folder from this public repository. The npx command in `plugin/.mcp.json` must be pinned to an exact version, and every submission gets a human review.

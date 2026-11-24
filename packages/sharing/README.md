# @wandr/sharing

The stretch rules of [`docs/05-architecture.md` §5.3](../../docs/05-architecture.md#53-the-stretch-rules-are-written-once), as pure functions both apps use: `pointsInStretch(route, ends)` and `resolveStretch(previousRoute, nextRoute, ends)`. Pure means no I/O, no database, no React, no time or randomness ([workspace WS-003](../../knowledge/standards/workspace.md#ws-003--packagessharing-stays-pure)).

They are written during the build, one test case per row of the scope's stretch rules ([testing T-003](../../knowledge/standards/testing.md#t-003--one-case-per-row)).

# Developing

## Table of Contents

[One-time Setup](#one-time-setup)</br>
[Quick Start](#quick-start)</br>
[Testing](#testing)</br>
[Debugging](#debugging)</br>
[Linking to the Packaging Plugin](#linking-to-the-packaging-plugin)</br>
[TypeScript Module Conflicts](#typescript-module-conflicts)</br>
[Useful Yarn Commands](#useful-yarn-commands)</br>

<hr>

## One-time Setup

1.  Install NodeJS. If you need to work with multiple versions of Node, you
    might consider using [nvm](https://github.com/creationix/nvm). </br>_Suggestion: use the current [LTS version of node](https://github.com/nodejs/release#release-schedule)._
1.  Install [yarn](https://yarnpkg.com/) to manage node dependencies. </br>_Suggestion: install yarn globally using `npm install --global yarn`_
1.  Clone this repository from git. E.g., (ssh): </br>`git clone git@github.com:forcedotcom/packaging.git`
1.  Configure [git commit signing](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

## Quick Start

1.  `cd` into the `packaging` directory
1.  Checkout the main branch: `git checkout main`
1.  Get all latest changes: `git pull`
1.  Download NPM dependencies: `yarn install`. If it's been a while since you last did this you may want to run `yarn clean-all` before this step.
1.  Build and lint the code: `yarn build`
1.  Create a branch off main for new work: `git checkout -b <branch_name>` _Suggestion: use branch_name format of initials/work-title_. For external contributors, please fork the main branch of the repo instead and PR the fork to the main branch.
1.  Make code changes and build: `yarn build`
1.  Write tests and run: `yarn test` (unit) and/or `yarn test:nuts` (NUTs)
1.  Show all changed files: `git status`
1.  Add all files to staging: `git add .`
1.  Commit staged files with helpful commit message: `git commit`
1.  Push commit(s) to remote: `git push -u origin <branch_name>`
1.  Create a pull request (PR) using the GitHub UI [here](https://github.com/forcedotcom/packaging).

## Testing

All changes must have associated tests. This library uses a combination of unit testing and NUTs (non-unit tests).

### Unit tests

Unit tests are run with `yarn test` and use the mocha test framework. Tests are located in the test directory and are named with the pattern, `<test-file>.test.ts`. E.g., [package.test.ts](test/package/package.test.ts). Reference the existing unit tests when writing and testing code changes.

### NUTs (non-unit tests)

Non-unit tests are run with `yarn test:nuts` and use the [cli-plugin-testkit](https://github.com/salesforcecli/cli-plugins-testkit) framework. These tests run using the default devhub in your environment and the test project located in `test/package/resources/packageProject`. This is a way to test the library code in a real environment versus a unit test environment where many things are stubbed.

## Debugging

If you need to debug library code or tests you should refer to the excellent documentation on this topic in the [Plugin Developer Guide](https://github.com/salesforcecli/cli/wiki/Debug-Your-Plugin).

## Linking to the packaging plugin

When you want to use a branch of this repo in the packaging plugin to test changes, follow these steps:

1.  With the library changes built (e.g., `yarn build`), link the library by running `yarn link`.
1.  `cd` to `plugin-packaging` and run `yarn clean-all`.
1.  Download NPM dependencies: `yarn install`.
1.  Use the linked packaging library: `yarn link "@salesforce/packaging"`.
1.  Build and lint the code: `yarn build`. If you get TypeScript module conflict errors during this step, see section below on TypeScript module conflicts.

## TypeScript Module Conflicts

During TypeScript compilation, you may see errors such as:

`error TS2322: Type 'import(".../plugin-packaging/node_modules/@salesforce/core/lib/org/connection").Connection' is not assignable to type 'import(".../packaging/node_modules/@salesforce/core/lib/org/connection").Connection'.`

This means the `Connection` interface in the core library used by the **packaging plugin** is different from the `Connection` interface in the core library used by the **packaging library**, most likely because the core library dependencies are different versions.

To fix this we need to tell the TypeScript compiler to use 1 version of that library. To do this, temporarily modify the [tsconfig.json](tsconfig.json) file with the following lines inside the `compilerOptions` section and recompile:

```json
"baseUrl": ".",
"paths": {
    "@salesforce/core": ["node_modules/@salesforce/core"]
}
```

If there are conflict errors in the tests then we need to make a similar modification to the [test/tsconfig.json](test/tsconfig.json) file. Note that the `baseUrl` property for this modification points to the directory above:

```json
"baseUrl": "..",
"paths": {
    "@salesforce/core": ["node_modules/@salesforce/core"]
}
```

**_Note that these are temporary changes for linked compilation and should not be committed._**

## Useful yarn commands

#### `yarn install`

This downloads all NPM dependencies into the node_modules directory.

#### `yarn compile`

This compiles the typescript to javascript.

#### `yarn lint`

This lints all the typescript using eslint.

#### `yarn build`

This compiles and lints all the typescript (e.g., `yarn compile && yarn lint`).

#### `yarn clean`

This cleans all generated files and directories. Run `yarn clean-all` to also clean up the node_module directories.

#### `yarn test`

This runs unit tests (mocha) for the project using ts-node.

#### `yarn test:nuts`

This runs NUTs (non-unit tests) for the project using ts-node.

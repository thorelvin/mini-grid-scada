@echo off
set "NODE_EXE=C:\Users\thore\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "NPX_CLI=%~dp0..\.runtime\npm\package\bin\npx-cli.js"
"%NODE_EXE%" "%NPX_CLI%" %*

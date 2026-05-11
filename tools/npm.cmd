@echo off
set "NODE_EXE=C:\Users\thore\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "NPM_CLI=%~dp0..\.runtime\npm\package\bin\npm-cli.js"
"%NODE_EXE%" "%NPM_CLI%" %*


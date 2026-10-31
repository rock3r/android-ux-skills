@echo off
setlocal
rem android-ux launcher (Windows cmd.exe).
rem Uses linear goto flow (no multi-line parenthesized blocks) so %var%
rem expansions and ! characters in user arguments are never mangled.
rem Fail-open guarantee: when %~1 is "hook" and Node >=20 or the bundle is
rem unavailable, prints {} to stdout, writes a one-time notice stamp, and exits 0.

if not defined ANDROID_UX_SKILL_DIR set "ANDROID_UX_SKILL_DIR=%~dp0.."
if not defined ANDROID_UX_SELF set "ANDROID_UX_SELF=%~f0"

set "is_hook=0"
if /I "%~1"=="hook" set "is_hook=1"

set "entry="
if exist "%~dp0android-ux.mjs" set "entry=%~dp0android-ux.mjs"
if defined entry goto have_entry
if exist "%~dp0..\bin\android-ux.mjs" set "entry=%~dp0..\bin\android-ux.mjs"
if defined entry goto have_entry

if "%is_hook%"=="1" goto fail_open_hook
echo [ERROR AUX-ENV-002] Bundled android-ux CLI entrypoint (android-ux.mjs) was not found. 1>&2
echo   Searched: "%~dp0android-ux.mjs", "%~dp0..\bin\android-ux.mjs" 1>&2
echo   Impact:   Cannot run android-ux commands from this launcher. 1>&2
echo   Fix:      Run scripts\sync-references.sh or reinstall via npx android-ux install. 1>&2
echo   Docs:     references/standards.md 1>&2
exit /b 1

:have_entry
set "node_bin="
if not defined ANDROID_UX_NODE goto try_path_node
if not exist "%ANDROID_UX_NODE%" goto bad_env_node
"%ANDROID_UX_NODE%" -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)" >nul 2>nul
if errorlevel 1 goto bad_env_node
set "node_bin=%ANDROID_UX_NODE%"
goto run_node

:bad_env_node
if "%is_hook%"=="1" goto fail_open_hook
echo [ERROR AUX-ENV-001] ANDROID_UX_NODE does not point to a valid Node.js ^>=20 executable. 1>&2
echo   Searched: ANDROID_UX_NODE=%ANDROID_UX_NODE% 1>&2
echo   Impact:   Deterministic CLI commands cannot run; skill workflows can fall back to direct file reading. 1>&2
echo   Fix:      Install Node.js ^>=20 (winget install OpenJS.NodeJS.LTS or scoop install nodejs-lts) or update ANDROID_UX_NODE. 1>&2
echo   Docs:     references/standards.md 1>&2
exit /b 1

:try_path_node
where node.exe >nul 2>nul
if errorlevel 1 goto try_program_files
node.exe -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)" >nul 2>nul
if errorlevel 1 goto try_program_files
set "node_bin=node.exe"
goto run_node

:try_program_files
if not exist "%ProgramFiles%\nodejs\node.exe" goto try_scoop_node
"%ProgramFiles%\nodejs\node.exe" -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)" >nul 2>nul
if errorlevel 1 goto try_scoop_node
set "node_bin=%ProgramFiles%\nodejs\node.exe"
goto run_node

:try_scoop_node
if not exist "%USERPROFILE%\scoop\shims\node.exe" goto no_node
"%USERPROFILE%\scoop\shims\node.exe" -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)" >nul 2>nul
if errorlevel 1 goto no_node
set "node_bin=%USERPROFILE%\scoop\shims\node.exe"
goto run_node

:no_node
if "%is_hook%"=="1" goto fail_open_hook
echo [ERROR AUX-ENV-001] Node.js ^>=20 is required to run android-ux. 1>&2
echo   Searched: ANDROID_UX_NODE, PATH, "%ProgramFiles%\nodejs\node.exe", "%USERPROFILE%\scoop\shims\node.exe" 1>&2
echo   Impact:   Deterministic CLI commands cannot run; skill workflows can still proceed by reading files directly. 1>&2
echo   Fix:      winget install OpenJS.NodeJS.LTS (or scoop install nodejs-lts), or set ANDROID_UX_NODE=C:\path\to\node.exe. 1>&2
echo   Docs:     references/standards.md 1>&2
exit /b 1

:fail_open_hook
set "cache_dir=%ANDROID_UX_CACHE_DIR%"
if not defined cache_dir if defined LOCALAPPDATA set "cache_dir=%LOCALAPPDATA%\android-ux\cache"
if not defined cache_dir if defined USERPROFILE set "cache_dir=%USERPROFILE%\.cache\android-ux"
if not defined cache_dir goto emit_empty_json
if exist "%cache_dir%\node-unsupported" goto emit_empty_json
if not exist "%cache_dir%\" mkdir "%cache_dir%" >nul 2>nul
(>"%cache_dir%\node-unsupported" echo node-missing-or-lt-20) 2>nul

:emit_empty_json
<nul set /p ={}
exit /b 0

:run_node
if "%is_hook%"=="1" goto run_hook_supervised
"%node_bin%" "%entry%" %*
exit /b %errorlevel%

:run_hook_supervised
"%node_bin%" "%entry%" %* 2>nul
if errorlevel 1 goto emit_empty_json
exit /b 0

@echo off
rem ArkStore iPhone setup: double-click to get this PC ready to install SideStore on an iPhone.
rem Runs setup-windows.ps1 from ArkStore's download site (installs Apple's iPhone drivers and iloader).
title ArkStore iPhone setup
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; iex (irm 'https://store.arkdevs.xyz/ios-setup/setup-windows.ps1')"
echo.
pause
